import { Injectable } from '@nestjs/common';

import { type gmail_v1 as gmailV1 } from 'googleapis';
import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';
import { type FileFolder } from 'twenty-shared/types';
import { In } from 'typeorm';
import { v5 } from 'uuid';

import { FileStorageService } from 'src/engine/core-modules/file-storage/services/file-storage.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type AttachmentWorkspaceEntity } from 'src/modules/attachment/standard-objects/attachment.workspace-entity';
import { type GmailAttachmentReference } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/get-attachment-data.util';
import {
  type GmailAttachmentValidationResult,
  validateGmailAttachment,
} from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/validate-gmail-attachment.util';

export const GMAIL_ATTACHMENT_MAX_MESSAGE_SIZE_BYTES = 20 * 1024 * 1024;
export const GMAIL_ATTACHMENT_MAX_AGGREGATE_SIZE_BYTES = 50 * 1024 * 1024;

const MESSAGE_ATTACHMENT_FILE_FOLDER = 'message-attachment' as FileFolder;
const GMAIL_ATTACHMENT_ID_NAMESPACE = '71d95ddb-a750-437d-bc66-1b31a73e0cfb';

type MessageAttachmentsToImport = {
  messageId: string;
  providerMessageId: string;
  attachments: GmailAttachmentReference[];
};

type AttachmentCandidate = {
  attachment: GmailAttachmentReference;
  attachmentId: string;
  fileId: string;
  messageId: string;
  providerMessageId: string;
  validation: GmailAttachmentValidationResult;
};

type ImportAttachmentsResult = {
  imported: number;
  quarantined: number;
  skipped: number;
};

const candidateKey = ({
  messageId,
  providerAttachmentId,
}: {
  messageId: string;
  providerAttachmentId: string;
}) => `${messageId}\0${providerAttachmentId}`;

const decodeBase64Url = (encodedContent: string): Buffer | null => {
  if (!/^[A-Za-z0-9_-]*={0,2}$/u.test(encodedContent)) {
    return null;
  }

  const unpaddedContent = encodedContent.replace(/=+$/u, '');

  if (unpaddedContent.length % 4 === 1) {
    return null;
  }

  const content = Buffer.from(unpaddedContent, 'base64url');

  return content.toString('base64url') === unpaddedContent ? content : null;
};

@Injectable()
export class GmailImportAttachmentsService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async importAttachments({
    gmailClient,
    connectedAccountId,
    workspaceId,
    messages,
  }: {
    gmailClient: gmailV1.Gmail;
    connectedAccountId: string;
    workspaceId: string;
    messages: MessageAttachmentsToImport[];
  }): Promise<ImportAttachmentsResult> {
    const allAttachmentCount = messages.reduce(
      (count, message) => count + message.attachments.length,
      0,
    );

    if (allAttachmentCount === 0) {
      return { imported: 0, quarantined: 0, skipped: 0 };
    }

    const candidates = messages.flatMap((message) =>
      message.attachments.map((attachment) => {
        const providerKey = `${connectedAccountId}\0${message.providerMessageId}\0${attachment.id}`;

        return {
          attachment,
          attachmentId: v5(
            `attachment\0${providerKey}`,
            GMAIL_ATTACHMENT_ID_NAMESPACE,
          ),
          fileId: v5(`file\0${providerKey}`, GMAIL_ATTACHMENT_ID_NAMESPACE),
          messageId: message.messageId,
          providerMessageId: message.providerMessageId,
        };
      }),
    );
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const attachmentRepository =
          await this.globalWorkspaceOrmManager.getRepository<AttachmentWorkspaceEntity>(
            workspaceId,
            'attachment',
            { shouldBypassPermissionChecks: true },
          );
        const existingAttachments = await attachmentRepository.find({
          where: {
            providerAttachmentId: In(
              candidates.map((candidate) => candidate.attachment.id),
            ),
          },
        });
        const existingAttachmentKeys = new Set(
          existingAttachments.map((existingAttachment) =>
            candidateKey({
              messageId: existingAttachment.messageId ?? '',
              providerAttachmentId:
                existingAttachment.providerAttachmentId ?? '',
            }),
          ),
        );
        const pendingCandidates = candidates.filter(
          (candidate) =>
            !existingAttachmentKeys.has(
              candidateKey({
                messageId: candidate.messageId,
                providerAttachmentId: candidate.attachment.id,
              }),
            ),
        );
        const skipped = candidates.length - pendingCandidates.length;

        const validatedCandidates: AttachmentCandidate[] = await Promise.all(
          pendingCandidates.map(async (candidate) => ({
            ...candidate,
            validation: await validateGmailAttachment({
              attachment: candidate.attachment,
            }),
          })),
        );
        const acceptedPreflightCandidates = validatedCandidates.filter(
          (candidate) => candidate.validation.safetyState === 'ACCEPTED',
        );
        const declaredAggregateSize = acceptedPreflightCandidates.reduce(
          (total, candidate) => total + candidate.attachment.size,
          0,
        );

        if (declaredAggregateSize > GMAIL_ATTACHMENT_MAX_AGGREGATE_SIZE_BYTES) {
          for (const candidate of acceptedPreflightCandidates) {
            candidate.validation = {
              ...candidate.validation,
              safetyState: 'QUARANTINED',
              quarantineReason: 'AGGREGATE_SIZE_LIMIT_EXCEEDED',
            };
          }
        } else {
          const declaredSizeByMessageId = new Map<string, number>();

          for (const candidate of acceptedPreflightCandidates) {
            declaredSizeByMessageId.set(
              candidate.messageId,
              (declaredSizeByMessageId.get(candidate.messageId) ?? 0) +
                candidate.attachment.size,
            );
          }

          for (const candidate of acceptedPreflightCandidates) {
            if (
              (declaredSizeByMessageId.get(candidate.messageId) ?? 0) >
              GMAIL_ATTACHMENT_MAX_MESSAGE_SIZE_BYTES
            ) {
              candidate.validation = {
                ...candidate.validation,
                safetyState: 'QUARANTINED',
                quarantineReason: 'MESSAGE_SIZE_LIMIT_EXCEEDED',
              };
            }
          }
        }

        let actualAggregateSize = 0;
        const actualSizeByMessageId = new Map<string, number>();
        let hasExceededActualAggregateSize = false;
        const messageIdsOverActualSizeLimit = new Set<string>();
        let imported = 0;
        let quarantined = 0;

        for (const candidate of validatedCandidates) {
          let content: Buffer | undefined;

          if (candidate.validation.safetyState === 'ACCEPTED') {
            if (hasExceededActualAggregateSize) {
              candidate.validation = {
                ...candidate.validation,
                safetyState: 'QUARANTINED',
                quarantineReason: 'AGGREGATE_SIZE_LIMIT_EXCEEDED',
              };
            } else if (messageIdsOverActualSizeLimit.has(candidate.messageId)) {
              candidate.validation = {
                ...candidate.validation,
                safetyState: 'QUARANTINED',
                quarantineReason: 'MESSAGE_SIZE_LIMIT_EXCEEDED',
              };
            } else {
              const response = await gmailClient.users.messages.attachments.get(
                {
                  userId: 'me',
                  messageId: candidate.providerMessageId,
                  id: candidate.attachment.id,
                },
              );
              const encodedContent = response.data.data ?? '';

              content = decodeBase64Url(encodedContent) ?? undefined;

              if (content === undefined) {
                candidate.validation = {
                  ...candidate.validation,
                  safetyState: 'QUARANTINED',
                  quarantineReason: 'MALFORMED_BASE64URL',
                };
              } else {
                candidate.validation = await validateGmailAttachment({
                  attachment: candidate.attachment,
                  content,
                });

                const nextActualAggregateSize =
                  actualAggregateSize + content.length;
                const nextActualMessageSize =
                  (actualSizeByMessageId.get(candidate.messageId) ?? 0) +
                  content.length;

                if (
                  nextActualAggregateSize >
                  GMAIL_ATTACHMENT_MAX_AGGREGATE_SIZE_BYTES
                ) {
                  hasExceededActualAggregateSize = true;
                  content = undefined;
                  candidate.validation = {
                    ...candidate.validation,
                    safetyState: 'QUARANTINED',
                    quarantineReason: 'AGGREGATE_SIZE_LIMIT_EXCEEDED',
                  };
                } else {
                  actualAggregateSize = nextActualAggregateSize;

                  if (
                    nextActualMessageSize >
                    GMAIL_ATTACHMENT_MAX_MESSAGE_SIZE_BYTES
                  ) {
                    messageIdsOverActualSizeLimit.add(candidate.messageId);
                    content = undefined;
                    candidate.validation = {
                      ...candidate.validation,
                      safetyState: 'QUARANTINED',
                      quarantineReason: 'MESSAGE_SIZE_LIMIT_EXCEEDED',
                    };
                  } else {
                    actualSizeByMessageId.set(
                      candidate.messageId,
                      nextActualMessageSize,
                    );
                  }
                }
              }
            }
          }

          const isAccepted =
            candidate.validation.safetyState === 'ACCEPTED' &&
            content !== undefined;

          if (isAccepted) {
            await this.fileStorageService.writeFile({
              sourceFile: content,
              resourcePath: `${candidate.messageId}/${candidate.attachmentId}/${candidate.validation.sanitizedFilename}`,
              fileFolder: MESSAGE_ATTACHMENT_FILE_FOLDER,
              applicationUniversalIdentifier:
                TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
              workspaceId,
              fileId: candidate.fileId,
              settings: {
                isTemporaryFile: false,
                toDelete: false,
              },
            });
            imported++;
          } else {
            quarantined++;
          }

          await attachmentRepository.upsert(
            {
              id: candidate.attachmentId,
              name: candidate.validation.sanitizedFilename,
              providerAttachmentId: candidate.attachment.id,
              fileId: isAccepted ? candidate.fileId : null,
              mimeType: candidate.validation.mimeType,
              size: candidate.validation.size,
              safetyState: candidate.validation.safetyState,
              quarantineReason: candidate.validation.quarantineReason,
              messageId: candidate.messageId,
            },
            ['id'],
          );
        }

        return { imported, quarantined, skipped };
      },
      authContext,
      { lite: true },
    );
  }
}

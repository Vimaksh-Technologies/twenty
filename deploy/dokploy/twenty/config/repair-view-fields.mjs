import fs from 'node:fs';

/**
 * Root cause: custom views were created with filters but no viewField columns.
 * Working views (e.g. All Companies) have visible columns; empty ones show blank tables.
 * This script adds object-appropriate columns, including Company/Person relations.
 */
const base = process.env.TWENTY_BASE_URL || 'http://localhost:3000';
const token = (process.env.TWENTY_TOKEN || '').trim();
if (!token) throw new Error('Set TWENTY_TOKEN to a target workspace token.');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function metadata(query, variables = {}) {
  const response = await fetch(`${base}/metadata`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join('; '));
  }
  return payload.data;
}

const COLUMN_SETS = {
  company: [
    ['name', 180],
    ['agencyStatus', 140],
    ['agencyType', 130],
    ['address', 160],
    ['assignedRm', 140],
    ['fitScore', 100],
    ['riskLevel', 110],
    ['monthlyEnquiries', 130],
    ['nextAction', 160],
    ['nextActionDate', 140],
    ['lastContacted', 140],
    ['demoNoShowCount', 120],
    ['doNotContact', 120],
    ['agencyLeadSource', 130],
    ['teamSize', 100],
    ['currentCrm', 140],
  ],
  person: [
    ['name', 180],
    ['company', 160],
    ['contactRole', 130],
    ['decisionMaker', 120],
    ['emails', 180],
    ['phones', 140],
    ['whatsappNumber', 140],
    ['preferredContactMethod', 140],
    ['contactStatus', 120],
    ['contactQuality', 120],
    ['consentToContact', 120],
    ['linkedinLink', 150],
    ['jobTitle', 140],
  ],
  opportunity: [
    ['name', 180],
    ['company', 160],
    ['stage', 140],
    ['amount', 130],
    ['closeDate', 140],
    ['pointOfContact', 150],
    ['owner', 130],
    ['proposedPlan', 120],
    ['nextAction', 150],
    ['competitor', 130],
    ['lostReason', 130],
    ['requirements', 160],
  ],
  lead: [
    ['name', 180],
    ['company', 160],
    ['person', 150],
    ['stage', 130],
    ['source', 120],
    ['priority', 110],
    ['assignedRm', 140],
    ['fitScore', 100],
    ['intentScore', 110],
    ['riskScore', 100],
    ['nextAction', 150],
    ['nextActionDate', 140],
    ['lastContactDate', 140],
    ['leadType', 140],
    ['opportunity', 150],
  ],
  demo: [
    ['name', 180],
    ['company', 160],
    ['person', 150],
    ['lead', 150],
    ['scheduledDate', 160],
    ['demoStatus', 120],
    ['demoType', 140],
    ['assignedRm', 140],
    ['decisionMakerAttendance', 140],
    ['customerFeedback', 180],
    ['internalRmFeedback', 180],
    ['leadSeriousness', 130],
    ['followUpDate', 140],
    ['recommendedNextStep', 150],
  ],
  inboundSubmission: [
    ['name', 180],
    ['submissionId', 130],
    ['source', 120],
    ['formName', 140],
    ['submittedDate', 150],
    ['agencyName', 160],
    ['submitterName', 140],
    ['submitterEmail', 180],
    ['submitterPhone', 130],
    ['processingStatus', 130],
    ['createdLead', 150],
  ],
};

async function main() {
  const objectsData = await metadata(`query {
    objects(paging: { first: 100 }) {
      edges { node { id nameSingular } }
    }
  }`);
  const objects = new Map(
    objectsData.objects.edges.map(({ node }) => [node.nameSingular, node.id]),
  );

  const fieldsByObject = new Map();
  for (const [nameSingular, objectId] of objects) {
    if (!COLUMN_SETS[nameSingular]) continue;
    const fields = await metadata(
      `query ($objectMetadataId: UUID!) {
        fields(filter: { objectMetadataId: { eq: $objectMetadataId } }, paging: { first: 200 }) {
          edges { node { id name } }
        }
      }`,
      { objectMetadataId: objectId },
    );
    fieldsByObject.set(
      nameSingular,
      new Map(fields.fields.edges.map(({ node }) => [node.name, node.id])),
    );
  }

  const views = await metadata(`query { getViews { id name type objectMetadataId } }`);
  const targetObjectIds = new Set([...objects.values()]);
  const repairTargets = views.getViews.filter((view) => targetObjectIds.has(view.objectMetadataId));

  const report = [];

  for (const view of repairTargets) {
    const objectName = [...objects.entries()].find(([, id]) => id === view.objectMetadataId)?.[0];
    if (!objectName || !COLUMN_SETS[objectName]) continue;

    const existing = await metadata(
      `query ($viewId: String!) {
        getViewFields(viewId: $viewId) { id fieldMetadataId isVisible }
      }`,
      { viewId: view.id },
    );
    const existingFieldIds = new Set(existing.getViewFields.map((f) => f.fieldMetadataId));
    const fieldMap = fieldsByObject.get(objectName);

    const toCreate = [];
    let position = 0;
    for (const [fieldName, size] of COLUMN_SETS[objectName]) {
      const fieldMetadataId = fieldMap.get(fieldName);
      if (!fieldMetadataId) continue;
      if (existingFieldIds.has(fieldMetadataId)) {
        position += 1;
        continue;
      }
      toCreate.push({
        viewId: view.id,
        fieldMetadataId,
        isVisible: true,
        size,
        position,
      });
      position += 1;
    }

    if (toCreate.length === 0) {
      report.push({
        name: view.name,
        object: objectName,
        action: 'already had columns',
        visible: existing.getViewFields.filter((f) => f.isVisible).length,
      });
      continue;
    }

    // Batch in chunks of 20
    for (let i = 0; i < toCreate.length; i += 20) {
      const chunk = toCreate.slice(i, i + 20);
      await metadata(
        `mutation ($inputs: [CreateViewFieldInput!]!) {
          createManyViewFields(inputs: $inputs) { id fieldMetadataId }
        }`,
        { inputs: chunk },
      );
    }

    const after = await metadata(
      `query ($viewId: String!) {
        getViewFields(viewId: $viewId) { id isVisible }
      }`,
      { viewId: view.id },
    );
    report.push({
      name: view.name,
      object: objectName,
      action: 'added columns',
      added: toCreate.length,
      visible: after.getViewFields.filter((f) => f.isVisible).length,
      includesCompany: COLUMN_SETS[objectName].some(([n]) => n === 'company'),
    });
  }

  fs.writeFileSync(new URL('./view-fields-repair-report.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

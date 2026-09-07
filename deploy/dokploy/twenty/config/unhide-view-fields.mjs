/**
 * Make important CRM columns visible on default INDEX ("All …") views
 * where fields exist but isVisible=false.
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

const MUST_SHOW = {
  company: [
    'name', 'agencyStatus', 'agencyType', 'address', 'assignedRm', 'fitScore',
    'riskLevel', 'monthlyEnquiries', 'nextAction', 'nextActionDate', 'lastContacted',
    'demoNoShowCount', 'doNotContact', 'agencyLeadSource', 'teamSize', 'currentCrm',
  ],
  person: [
    'name', 'company', 'contactRole', 'decisionMaker', 'emails', 'phones',
    'whatsappNumber', 'preferredContactMethod', 'contactStatus', 'contactQuality',
  ],
  opportunity: [
    'name', 'company', 'stage', 'amount', 'closeDate', 'pointOfContact',
    'owner', 'proposedPlan', 'nextAction', 'competitor',
  ],
  lead: [
    'name', 'company', 'person', 'stage', 'source', 'priority', 'assignedRm',
    'fitScore', 'intentScore', 'riskScore', 'nextAction', 'nextActionDate', 'leadType',
  ],
  demo: [
    'name', 'company', 'person', 'lead', 'scheduledDate', 'demoStatus', 'demoType',
    'assignedRm', 'customerFeedback', 'internalRmFeedback', 'followUpDate',
  ],
  inboundSubmission: [
    'name', 'submissionId', 'source', 'formName', 'submittedDate', 'agencyName',
    'submitterName', 'submitterEmail', 'processingStatus', 'createdLead',
  ],
};

async function main() {
  const objectsData = await metadata(`query {
    objects(paging: { first: 100 }) {
      edges { node { id nameSingular } }
    }
  }`);
  const objects = new Map(objectsData.objects.edges.map(({ node }) => [node.id, node.nameSingular]));

  const fieldsByObject = new Map();
  for (const [objectId, nameSingular] of objects) {
    if (!MUST_SHOW[nameSingular]) continue;
    const fields = await metadata(
      `query ($objectMetadataId: UUID!) {
        fields(filter: { objectMetadataId: { eq: $objectMetadataId } }, paging: { first: 200 }) {
          edges { node { id name } }
        }
      }`,
      { objectMetadataId: objectId },
    );
    fieldsByObject.set(
      objectId,
      new Map(fields.fields.edges.map(({ node }) => [node.name, node.id])),
    );
  }

  const views = (await metadata(`query { getViews { id name type key objectMetadataId } }`)).getViews;
  const report = [];

  for (const view of views) {
    const objectName = objects.get(view.objectMetadataId);
    if (!MUST_SHOW[objectName]) continue;

    const fieldMap = fieldsByObject.get(view.objectMetadataId);
    const mustIds = new Set(
      MUST_SHOW[objectName].map((name) => fieldMap.get(name)).filter(Boolean),
    );

    const viewFields = await metadata(
      `query ($viewId: String!) {
        getViewFields(viewId: $viewId) { id fieldMetadataId isVisible position size }
      }`,
      { viewId: view.id },
    );

    let updated = 0;
    for (const vf of viewFields.getViewFields) {
      if (!mustIds.has(vf.fieldMetadataId)) continue;
      if (vf.isVisible) continue;
      await metadata(
        `mutation ($input: UpdateViewFieldInput!) {
          updateViewField(input: $input) { id isVisible }
        }`,
        {
          input: {
            id: vf.id,
            update: { isVisible: true },
          },
        },
      );
      updated += 1;
    }

    if (updated > 0) {
      report.push({ name: view.name, object: objectName, madeVisible: updated });
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

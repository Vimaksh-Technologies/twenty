import fs from 'node:fs';
import crypto from 'node:crypto';

const base = process.env.TWENTY_BASE_URL || 'http://localhost:3000';
const token = (process.env.TWENTY_TOKEN || '').trim();
if (!token) throw new Error('Set TWENTY_TOKEN to an interactive workspace token.');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function request(endpoint, query, variables = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }
  return payload.data;
}

const core = (query, variables) => request('/graphql', query, variables);
const meta = (query, variables) => request('/metadata', query, variables);
const id = () => crypto.randomUUID();

async function objectAndFields(nameSingular) {
  const objectData = await meta(`query {
    objects(paging: { first: 100 }) {
      edges { node { id nameSingular } }
    }
  }`);
  const object = objectData.objects.edges
    .map(({ node }) => node)
    .find((node) => node.nameSingular === nameSingular);
  const fieldData = await meta(
    `query ($objectMetadataId: UUID!) {
      fields(filter: { objectMetadataId: { eq: $objectMetadataId } }, paging: { first: 200 }) {
        edges { node { id name type } }
      }
    }`,
    { objectMetadataId: object.id },
  );
  return {
    object,
    fields: new Map(fieldData.fields.edges.map(({ node }) => [node.name, node])),
  };
}

function filter(field, value, operand = 'IS') {
  const groupId = id();
  return {
    stepFilters: [
      {
        id: id(),
        type: field.type,
        value: operand === 'IS_EMPTY' ? JSON.stringify([]) : JSON.stringify([value]),
        operand,
        stepOutputKey: `{{trigger.properties.after.${field.name}}}`,
        fieldMetadataId: field.id,
        stepFilterGroupId: groupId,
        positionInStepFilterGroup: 0,
      },
    ],
    stepFilterGroups: [{ id: groupId, logicalOperator: 'AND' }],
  };
}

function taskStep(stepId, title) {
  return {
    id: stepId,
    name: 'Create Task',
    type: 'CREATE_RECORD',
    valid: true,
    settings: {
      input: {
        objectName: 'task',
        objectRecord: { title, status: 'TODO' },
      },
      outputSchema: {},
      errorHandlingOptions: {
        retryOnFailure: { value: false },
        continueOnFailure: { value: false },
      },
    },
    nextStepIds: [],
  };
}

async function updateTrigger(workflowVersionId, trigger) {
  try {
    await core(
      `mutation ($input: UpdateWorkflowVersionTriggerInput!) {
        updateWorkflowVersionTrigger(input: $input) { trigger }
      }`,
      { input: { workflowVersionId, trigger } },
    );
  } catch (error) {
    if (!error.message.includes('UpdateWorkflowVersionTriggerInput')) throw error;
    await core(
      `mutation ($id: UUID!, $data: WorkflowVersionUpdateInput!) {
        updateWorkflowVersion(id: $id, data: $data) { id status }
      }`,
      { id: workflowVersionId, data: { trigger, status: 'DRAFT' } },
    );
  }
}

async function main() {
  const lead = await objectAndFields('lead');
  const demo = await objectAndFields('demo');
  const workflowData = await core(`query {
    workflows(first: 100) {
      edges {
        node {
          id name createdAt
          versions(first: 10) { edges { node { id status trigger steps } } }
        }
      }
    }
  }`);
  const all = workflowData.workflows.edges.map(({ node }) => node);

  const specs = [
    {
      name: 'New Lead → First Contact Task',
      eventName: 'lead.created',
      step: (stepId) => taskStep(stepId, 'First contact: call or WhatsApp new lead'),
    },
    {
      name: 'Demo Scheduled → Prep & Reminder Tasks',
      eventName: 'demo.created',
      triggerFilter: filter(demo.fields.get('demoStatus'), 'SCHEDULED'),
      step: (stepId) => taskStep(stepId, 'Prepare demo agenda and send reminder'),
    },
    {
      name: 'Demo Completed → Feedback & Follow-up',
      eventName: 'demo.updated',
      triggerFilter: filter(demo.fields.get('demoStatus'), 'COMPLETED'),
      step: (stepId) => taskStep(stepId, 'Capture customer and RM feedback, then follow up'),
    },
    {
      name: 'Demo No-Show → Follow-up & Risk Review',
      eventName: 'demo.updated',
      triggerFilter: filter(demo.fields.get('demoStatus'), 'NO_SHOW'),
      step: (stepId) => taskStep(stepId, 'No-show follow-up and risk review'),
    },
    {
      name: 'Lead Qualified → Create Opportunity',
      eventName: 'lead.updated',
      triggerFilter: filter(lead.fields.get('stage'), 'QUALIFIED'),
      step: (stepId) => ({
        id: stepId,
        name: 'Create Opportunity',
        type: 'CREATE_RECORD',
        valid: true,
        settings: {
          input: {
            objectName: 'opportunity',
            objectRecord: {
              name: 'Opportunity from qualified lead',
              stage: 'QUALIFIED',
              companyId: '{{trigger.properties.after.companyId}}',
              pointOfContactId: '{{trigger.properties.after.personId}}',
            },
          },
          outputSchema: {},
          errorHandlingOptions: {
            retryOnFailure: { value: false },
            continueOnFailure: { value: false },
          },
        },
        nextStepIds: [],
      }),
    },
    {
      name: 'Active Lead Without Next Action → Create Task',
      eventName: 'lead.updated',
      triggerFilter: filter(lead.fields.get('nextAction'), null, 'IS_EMPTY'),
      step: (stepId) => taskStep(stepId, 'Set next action for active lead'),
    },
  ];

  const result = [];
  for (const spec of specs) {
    const matches = all
      .filter((workflow) => workflow.name === spec.name)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const keep = matches[0];
    if (!keep) {
      result.push({ name: spec.name, error: 'workflow shell missing' });
      continue;
    }
    const versions = keep.versions.edges.map(({ node }) => node);
    let version = versions.find((candidate) => candidate.status === 'DRAFT');
    if (!version) {
      const created = await core(
        `mutation ($data: WorkflowVersionCreateInput!) {
          createWorkflowVersion(data: $data) { id status trigger steps }
        }`,
        { data: { workflowId: keep.id, status: 'DRAFT' } },
      );
      version = created.createWorkflowVersion;
    }
    const obsoleteVersions = versions.filter((candidate) => candidate.id !== version.id);
    for (const obsoleteVersion of obsoleteVersions) {
      if (obsoleteVersion.status === 'ACTIVE') {
        await core(
          `mutation ($id: UUID!, $data: WorkflowVersionUpdateInput!) {
            updateWorkflowVersion(id: $id, data: $data) { id status }
          }`,
          { id: obsoleteVersion.id, data: { status: 'DEACTIVATED' } },
        );
      }
      await core(
        `mutation ($id: UUID!) { destroyWorkflowVersion(id: $id) { id } }`,
        { id: obsoleteVersion.id },
      );
    }

    const existingSteps = version.steps || [];
    const stepId = existingSteps[0]?.id || id();
    const step = spec.step(stepId);
    const trigger = {
      name: `Record event: ${spec.eventName}`,
      type: 'DATABASE_EVENT',
      settings: {
        eventName: spec.eventName,
        fields: [],
        filter: spec.triggerFilter,
        outputSchema: {},
      },
      nextStepIds: [stepId],
    };

    await updateTrigger(version.id, trigger);
    if (existingSteps.length === 0) {
      await core(
        `mutation ($input: CreateWorkflowVersionStepInput!) {
          createWorkflowVersionStep(input: $input) { __typename }
        }`,
        {
          input: {
            workflowVersionId: version.id,
            stepType: step.type,
            parentStepId: 'trigger',
            id: stepId,
          },
        },
      );
    }
    await core(
      `mutation ($input: UpdateWorkflowVersionStepInput!) {
        updateWorkflowVersionStep(input: $input) { id }
      }`,
      { input: { workflowVersionId: version.id, step } },
    );
    for (const extraStep of existingSteps.slice(1)) {
      await core(
        `mutation ($input: DeleteWorkflowVersionStepInput!) {
          deleteWorkflowVersionStep(input: $input) { __typename }
        }`,
        { input: { workflowVersionId: version.id, stepId: extraStep.id } },
      );
    }

    for (const duplicate of matches.slice(1)) {
      await core(
        `mutation ($id: UUID!) { destroyWorkflow(id: $id) { id } }`,
        { id: duplicate.id },
      );
    }
    result.push({
      name: spec.name,
      status: 'DRAFT',
      trigger: spec.eventName,
      duplicatesRemoved: Math.max(0, matches.length - 1),
      versionsRemoved: obsoleteVersions.length,
      note: spec.note,
    });
  }

  fs.writeFileSync(
    new URL('./workflow-draft-report.json', import.meta.url),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

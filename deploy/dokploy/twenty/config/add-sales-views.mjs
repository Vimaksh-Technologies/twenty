const base = process.env.TWENTY_BASE_URL || 'http://localhost:3000';
const token = (process.env.TWENTY_TOKEN || '').trim();
if (!token) throw new Error('Set TWENTY_TOKEN to a target workspace token.');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const valuesEqual = (left, right) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

async function metadata(query, variables = {}) {
  const response = await fetch(`${base}/metadata`, {
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

async function model(nameSingular) {
  const objects = await metadata(`query {
    objects(paging: { first: 100 }) {
      edges { node { id nameSingular } }
    }
  }`);
  const object = objects.objects.edges
    .map(({ node }) => node)
    .find((node) => node.nameSingular === nameSingular);
  const fields = await metadata(
    `query ($objectMetadataId: UUID!) {
      fields(filter: { objectMetadataId: { eq: $objectMetadataId } }, paging: { first: 200 }) {
        edges { node { id name type options } }
      }
    }`,
    { objectMetadataId: object.id },
  );
  return {
    id: object.id,
    fields: new Map(fields.fields.edges.map(({ node }) => [node.name, node])),
  };
}

async function existingViews() {
  const data = await metadata(`query {
    getViews {
      id name type objectMetadataId mainGroupByFieldMetadataId
      calendarFieldMetadataId calendarLayout
    }
  }`);
  return data.getViews;
}

async function ensureView(spec, views) {
  const matches = views.filter((view) => view.name === spec.name);
  const existing = matches.find((view) => view.objectMetadataId === spec.objectMetadataId);
  for (const duplicate of matches.filter((view) => view.id !== existing?.id)) {
    await metadata(
      `mutation ($id: String!) { destroyView(id: $id) { id } }`,
      { id: duplicate.id },
    );
  }
  if (existing) {
    const updated = await metadata(
      `mutation ($id: String!, $input: UpdateViewInput!) {
        updateView(id: $id, input: $input) {
          id name type objectMetadataId mainGroupByFieldMetadataId
        }
      }`,
      {
        id: existing.id,
        input: {
          id: existing.id,
          name: spec.name,
          type: spec.type ?? 'TABLE',
          icon: spec.icon,
          visibility: 'WORKSPACE',
          mainGroupByFieldMetadataId: spec.mainGroupByFieldMetadataId,
        },
      },
    );
    return { ...updated.updateView, reused: true };
  }
  const data = await metadata(
    `mutation ($input: CreateViewInput!) {
      createView(input: $input) { id name type objectMetadataId }
    }`,
    {
      input: {
        name: spec.name,
        objectMetadataId: spec.objectMetadataId,
        type: spec.type ?? 'TABLE',
        icon: spec.icon,
        visibility: 'WORKSPACE',
        mainGroupByFieldMetadataId: spec.mainGroupByFieldMetadataId,
      },
    },
  );
  views.push(data.createView);
  return data.createView;
}

async function ensureFilter(viewId, fieldMetadataId, operand, value) {
  const data = await metadata(
    `query ($viewId: String!) {
      getViewFilters(viewId: $viewId) { id fieldMetadataId operand value }
    }`,
    { viewId },
  );
  const matches = data.getViewFilters.filter((filter) => filter.fieldMetadataId === fieldMetadataId);
  const current = matches[0];
  if (!current) {
    await metadata(
      `mutation ($input: CreateViewFilterInput!) {
        createViewFilter(input: $input) { id }
      }`,
      { input: { viewId, fieldMetadataId, operand, value } },
    );
    return;
  }
  if (current.operand !== operand || !valuesEqual(current.value, value)) {
    await metadata(
      `mutation ($input: UpdateViewFilterInput!) {
        updateViewFilter(input: $input) { id }
      }`,
      { input: { id: current.id, update: { fieldMetadataId, operand, value } } },
    );
  }
  for (const duplicate of matches.slice(1)) {
    await metadata(
      `mutation ($input: DeleteViewFilterInput!) {
        deleteViewFilter(input: $input) { id }
      }`,
      { input: { id: duplicate.id } },
    );
  }
}

async function removeUnexpectedFilters(viewId, expectedFilters) {
  const data = await metadata(
    `query ($viewId: String!) {
      getViewFilters(viewId: $viewId) { id fieldMetadataId operand value }
    }`,
    { viewId },
  );
  for (const filter of data.getViewFilters) {
    const expected = expectedFilters.some(
      ([fieldMetadataId, operand, value]) =>
        filter.fieldMetadataId === fieldMetadataId &&
        filter.operand === operand &&
        valuesEqual(filter.value, value),
    );
    if (!expected) {
      await metadata(
        `mutation ($input: DeleteViewFilterInput!) {
          deleteViewFilter(input: $input) { id }
        }`,
        { input: { id: filter.id } },
      );
    }
  }
}

async function addKanbanGroups(viewId, field) {
  const data = await metadata(
    `query ($viewId: String!) {
      getViewGroups(viewId: $viewId) { id fieldValue isVisible position }
    }`,
    { viewId },
  );
  const desiredValues = new Set((field.options ?? []).map(({ value }) => value));
  const seenValues = new Set();
  const retainedGroups = [];
  for (const group of data.getViewGroups) {
    if (!desiredValues.has(group.fieldValue) || seenValues.has(group.fieldValue)) {
      await metadata(
        `mutation ($input: DeleteViewGroupInput!) {
          deleteViewGroup(input: $input) { id }
        }`,
        { input: { id: group.id } },
      );
      continue;
    }
    seenValues.add(group.fieldValue);
    retainedGroups.push(group);
  }
  const groupsByValue = new Map(retainedGroups.map((group) => [group.fieldValue, group]));
  for (const option of field.options ?? []) {
    const current = groupsByValue.get(option.value);
    if (!current) {
      await metadata(
        `mutation ($input: CreateViewGroupInput!) {
          createViewGroup(input: $input) { id }
        }`,
        {
          input: {
            viewId,
            fieldMetadataId: field.id,
            fieldValue: option.value,
            isVisible: true,
            position: option.position,
          },
        },
      );
      continue;
    }
    if (!current.isVisible || current.position !== option.position) {
      await metadata(
        `mutation ($input: UpdateViewGroupInput!) {
          updateViewGroup(input: $input) { id }
        }`,
        {
          input: {
            id: current.id,
            update: {
              fieldMetadataId: field.id,
              fieldValue: option.value,
              isVisible: true,
              position: option.position,
            },
          },
        },
      );
    }
  }
}

async function main() {
  const [lead, demo, opportunity, company] = await Promise.all([
    model('lead'),
    model('demo'),
    model('opportunity'),
    model('company'),
  ]);
  const views = await existingViews();

  const specifications = [
    {
      name: 'Qualified Leads',
      objectMetadataId: lead.id,
      icon: 'IconCircleCheck',
      filters: [[lead.fields.get('stage').id, 'IS', ['QUALIFIED']]],
    },
    {
      name: 'Leads Requiring Demo',
      objectMetadataId: lead.id,
      icon: 'IconPresentation',
      filters: [[lead.fields.get('stage').id, 'IS', ['DEMO_REQUIRED']]],
    },
    {
      name: 'Unassigned Active Leads',
      objectMetadataId: lead.id,
      icon: 'IconUserQuestion',
      filters: [
        [lead.fields.get('assignedRm').id, 'IS_EMPTY', true],
        [lead.fields.get('stage').id, 'IS_NOT', ['WON', 'LOST', 'CONVERTED', 'BLOCKED']],
      ],
    },
    {
      name: 'Hot Leads',
      objectMetadataId: lead.id,
      icon: 'IconFlame',
      filters: [
        [lead.fields.get('fitScore').id, 'GREATER_THAN_OR_EQUAL', 75],
        [lead.fields.get('intentScore').id, 'GREATER_THAN_OR_EQUAL', 70],
      ],
    },
    {
      name: 'Nurture Leads',
      objectMetadataId: lead.id,
      icon: 'IconPlant',
      filters: [[lead.fields.get('stage').id, 'IS', ['NURTURE']]],
    },
    {
      name: 'Demo Follow-ups Due Today',
      objectMetadataId: demo.id,
      icon: 'IconCalendarDue',
      filters: [[demo.fields.get('followUpDate').id, 'IS_TODAY', true]],
    },
    {
      name: 'High-Seriousness Completed Demos',
      objectMetadataId: demo.id,
      icon: 'IconFlame',
      filters: [
        [demo.fields.get('demoStatus').id, 'IS', ['COMPLETED']],
        [demo.fields.get('leadSeriousness').id, 'IS', ['HIGH']],
      ],
    },
    {
      name: 'Won Opportunities',
      objectMetadataId: opportunity.id,
      icon: 'IconTrophy',
      filters: [[opportunity.fields.get('stage').id, 'IS', ['WON']]],
    },
    {
      name: 'Lost Opportunities',
      objectMetadataId: opportunity.id,
      icon: 'IconThumbDown',
      filters: [[opportunity.fields.get('stage').id, 'IS', ['LOST']]],
    },
    {
      name: 'Decision-Pending Opportunities',
      objectMetadataId: opportunity.id,
      icon: 'IconHourglass',
      filters: [[opportunity.fields.get('stage').id, 'IS', ['DECISION_PENDING']]],
    },
    {
      name: 'High-Risk Agencies',
      objectMetadataId: company.id,
      icon: 'IconAlertTriangle',
      filters: [[company.fields.get('riskLevel').id, 'IS', ['HIGH', 'CRITICAL']]],
    },
    {
      name: 'Do Not Contact Agencies',
      objectMetadataId: company.id,
      icon: 'IconBan',
      filters: [[company.fields.get('doNotContact').id, 'IS', true]],
    },
    {
      name: 'Agencies by Status',
      objectMetadataId: company.id,
      type: 'KANBAN',
      icon: 'IconLayoutKanban',
      mainGroupByFieldMetadataId: company.fields.get('agencyStatus').id,
      kanbanField: company.fields.get('agencyStatus'),
      filters: [],
    },
  ];

  const result = [];
  for (const specification of specifications) {
    const view = await ensureView(specification, views);
    for (const filter of specification.filters) {
      await ensureFilter(view.id, ...filter);
    }
    if (specification.kanbanField) {
      await addKanbanGroups(view.id, specification.kanbanField);
    }
    result.push({ name: specification.name, type: specification.type ?? 'TABLE', reused: !!view.reused });
    await removeUnexpectedFilters(view.id, specification.filters);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

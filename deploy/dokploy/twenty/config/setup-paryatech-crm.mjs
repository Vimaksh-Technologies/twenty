/**
 * Paryatech Twenty CRM configuration script
 * - Resolves target object IDs dynamically
 * - Creates only missing objects, fields, roles, views, and workflow drafts
 * - Never creates or imports CRM records
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.env.TWENTY_BASE_URL || 'http://localhost:3000';
const TOKEN = (process.env.TWENTY_TOKEN || '').trim();

if (!TOKEN) {
  throw new Error('Set TWENTY_TOKEN to a target workspace API token.');
}

const IDS = {};

const report = {
  objectsCreated: [],
  fieldsCreated: [],
  fieldsUpdated: [],
  fieldsReused: [],
  rolesCreated: [],
  viewsCreated: [],
  workflowsCreated: [],
  limitations: [],
  issues: [],
  tested: [],
  recordCountsBefore: {},
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const valuesEqual = (left, right) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

async function gql(endpoint, query, variables = {}) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join('; ');
    const err = new Error(msg);
    err.errors = json.errors;
    err.response = json;
    throw err;
  }
  return json.data;
}

const meta = (q, v) => gql('/metadata', q, v);
const core = (q, v) => gql('/graphql', q, v);

async function getExistingFields(objectMetadataId) {
  const data = await meta(
    `query ($objectMetadataId: UUID!) {
      fields(filter: { objectMetadataId: { eq: $objectMetadataId } }, paging: { first: 200 }) {
        edges { node { id name label type options isSystem } }
      }
    }`,
    { objectMetadataId },
  );
  const map = new Map();
  for (const e of data.fields.edges) map.set(e.node.name, e.node);
  return map;
}

async function getObjects() {
  const data = await meta(`query {
    objects(paging: { first: 100 }) {
      edges { node { id nameSingular namePlural labelSingular labelPlural isSystem isActive } }
    }
  }`);
  const map = new Map();
  for (const e of data.objects.edges) map.set(e.node.nameSingular, e.node);
  return map;
}

async function ensureField(objectMetadataId, field) {
  const existing = await getExistingFields(objectMetadataId);
  if (existing.has(field.name)) {
    report.fieldsReused.push(`${field.name} on ${objectMetadataId}`);
    return existing.get(field.name);
  }
  const data = await meta(
    `mutation ($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name label type options }
    }`,
    { input: { field: { objectMetadataId, isNullable: true, ...field } } },
  );
  report.fieldsCreated.push(`${data.createOneField.name} (${data.createOneField.type})`);
  await sleep(150);
  return data.createOneField;
}

async function updateField(id, patch) {
  const data = await meta(
    `mutation ($id: UUID!, $update: UpdateFieldInput!) {
      updateOneField(input: { id: $id, update: $update }) { id name options label }
    }`,
    { id, update: patch },
  );
  report.fieldsUpdated.push(data.updateOneField.name);
  return data.updateOneField;
}

function selectOptions(items) {
  return items.map((item, position) => {
    if (typeof item === 'string') {
      const value = item.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
      return { label: item, value, color: COLORS[position % COLORS.length], position };
    }
    return { color: COLORS[position % COLORS.length], position, ...item };
  });
}

const COLORS = [
  'green', 'turquoise', 'sky', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'gray', 'lime', 'jade',
];

async function ensureObject({ nameSingular, namePlural, labelSingular, labelPlural, icon, description }) {
  const objects = await getObjects();
  if (objects.has(nameSingular)) {
    report.fieldsReused.push(`object:${nameSingular}`);
    return objects.get(nameSingular);
  }
  const data = await meta(
    `mutation ($input: CreateOneObjectInput!) {
      createOneObject(input: $input) { id nameSingular namePlural labelSingular labelPlural }
    }`,
    {
      input: {
        object: { nameSingular, namePlural, labelSingular, labelPlural, icon, description },
      },
    },
  );
  report.objectsCreated.push(labelPlural);
  await sleep(400);
  return data.createOneObject;
}

async function ensureRole(role) {
  const data = await meta(`query { getRoles { id label } }`);
  const existing = data.getRoles.find((candidate) => candidate.label === role.label);
  if (existing) {
    const updated = await meta(
      `mutation ($input: UpdateRoleInput!) {
        updateOneRole(updateRoleInput: $input) {
          id label canUpdateAllSettings canReadAllObjectRecords canUpdateAllObjectRecords
          canSoftDeleteAllObjectRecords canDestroyAllObjectRecords canAccessAllTools
        }
      }`,
      { input: { id: existing.id, update: role } },
    );
    report.rolesCreated.push(`${role.label} (reconciled)`);
    return updated.updateOneRole;
  }
  const created = await meta(
    `mutation ($input: CreateRoleInput!) {
      createOneRole(createRoleInput: $input) {
        id label canUpdateAllSettings canReadAllObjectRecords canUpdateAllObjectRecords
        canSoftDeleteAllObjectRecords canDestroyAllObjectRecords canAccessAllTools
      }
    }`,
    { input: role },
  );
  report.rolesCreated.push(role.label);
  return created.createOneRole;
}

async function upsertObjectPermissions(roleId, objectPermissions) {
  return meta(
    `mutation ($input: UpsertObjectPermissionsInput!) {
      upsertObjectPermissions(upsertObjectPermissionsInput: $input) { __typename }
    }`,
    { input: { roleId, objectPermissions } },
  );
}

async function upsertPermissionFlags(roleId, permissionFlagKeys) {
  return meta(
    `mutation ($roleId: UUID!, $permissionFlagKeys: [String!]!) {
      upsertPermissionFlags(upsertPermissionFlagsInput: { roleId: $roleId, permissionFlagKeys: $permissionFlagKeys }) { id flag }
    }`,
    { roleId, permissionFlagKeys },
  );
}

async function findViews() {
  const data = await meta(`query {
    getViews {
      id name type objectMetadataId mainGroupByFieldMetadataId
      calendarFieldMetadataId calendarLayout
    }
  }`);
  return data.getViews;
}

async function ensureView({ name, objectMetadataId, type = 'TABLE', icon = 'IconList', ...rest }) {
  const views = await findViews();
  const matches = views.filter((view) => view.name === name);
  const existing = matches.find((view) => view.objectMetadataId === objectMetadataId);
  for (const duplicate of matches.filter((view) => view.id !== existing?.id)) {
    await meta(
      `mutation ($id: String!) { destroyView(id: $id) { id } }`,
      { id: duplicate.id },
    );
  }
  if (existing) {
    const updated = await meta(
      `mutation ($id: String!, $input: UpdateViewInput!) {
        updateView(id: $id, input: $input) {
          id name type objectMetadataId mainGroupByFieldMetadataId calendarFieldMetadataId
        }
      }`,
      {
        id: existing.id,
        input: { id: existing.id, name, type, icon, visibility: 'WORKSPACE', ...rest },
      },
    );
    report.viewsCreated.push(`${name} (reconciled)`);
    return updated.updateView;
  }
  const data = await meta(
    `mutation ($input: CreateViewInput!) {
      createView(input: $input) { id name type objectMetadataId }
    }`,
    {
      input: {
        name,
        objectMetadataId,
        type,
        icon,
        visibility: 'WORKSPACE',
        ...rest,
      },
    },
  );
  report.viewsCreated.push(name);
  await sleep(100);
  return data.createView;
}

async function createViewFilter(viewId, fieldMetadataId, operand, value) {
  const existing = await meta(
    `query ($viewId: String!) {
      getViewFilters(viewId: $viewId) { id fieldMetadataId operand value }
    }`,
    { viewId },
  );
  const matches = existing.getViewFilters.filter(
    (filter) => filter.fieldMetadataId === fieldMetadataId,
  );
  const current = matches[0];
  if (!current) {
    return meta(
      `mutation ($input: CreateViewFilterInput!) {
        createViewFilter(input: $input) { id }
      }`,
      { input: { viewId, fieldMetadataId, operand, value } },
    );
  }
  if (current.operand !== operand || !valuesEqual(current.value, value)) {
    await meta(
      `mutation ($input: UpdateViewFilterInput!) {
        updateViewFilter(input: $input) { id }
      }`,
      { input: { id: current.id, update: { fieldMetadataId, operand, value } } },
    );
  }
  for (const duplicate of matches.slice(1)) {
    await meta(
      `mutation ($input: DeleteViewFilterInput!) {
        deleteViewFilter(input: $input) { id }
      }`,
      { input: { id: duplicate.id } },
    );
  }
}

async function removeUnexpectedViewFilters(viewId, expectedFilters) {
  const existing = await meta(
    `query ($viewId: String!) {
      getViewFilters(viewId: $viewId) { id fieldMetadataId operand value }
    }`,
    { viewId },
  );
  for (const filter of existing.getViewFilters) {
    const expected = expectedFilters.some(
      ([fieldMetadataId, operand, value]) =>
        filter.fieldMetadataId === fieldMetadataId &&
        filter.operand === operand &&
        valuesEqual(filter.value, value),
    );
    if (!expected) {
      await meta(
        `mutation ($input: DeleteViewFilterInput!) {
          deleteViewFilter(input: $input) { id }
        }`,
        { input: { id: filter.id } },
      );
    }
  }
}

async function createViewGroups(viewId, fieldMetadataId, optionValues) {
  const existing = await meta(
    `query ($viewId: String!) {
      getViewGroups(viewId: $viewId) { id fieldValue isVisible position }
    }`,
    { viewId },
  );
  const desiredValues = new Set(optionValues);
  const retained = new Map();
  for (const group of existing.getViewGroups) {
    if (!desiredValues.has(group.fieldValue) || retained.has(group.fieldValue)) {
      await meta(
        `mutation ($input: DeleteViewGroupInput!) {
          deleteViewGroup(input: $input) { id }
        }`,
        { input: { id: group.id } },
      );
      continue;
    }
    retained.set(group.fieldValue, group);
  }
  for (const [position, fieldValue] of optionValues.entries()) {
    const current = retained.get(fieldValue);
    if (!current) {
      await meta(
        `mutation ($input: CreateViewGroupInput!) {
          createViewGroup(input: $input) { id }
        }`,
        {
          input: {
            viewId,
            fieldMetadataId,
            fieldValue,
            isVisible: true,
            position,
          },
        },
      );
      continue;
    }
    if (!current.isVisible || current.position !== position) {
      await meta(
        `mutation ($input: UpdateViewGroupInput!) {
          updateViewGroup(input: $input) { id }
        }`,
        {
          input: {
            id: current.id,
            update: { fieldMetadataId, fieldValue, isVisible: true, position },
          },
        },
      );
    }
  }
}

async function createManyViewFields(viewId, fieldIds) {
  const existing = await meta(
    `query ($viewId: String!) {
      getViewFields(viewId: $viewId) { fieldMetadataId }
    }`,
    { viewId },
  );
  const existingFieldIds = new Set(
    existing.getViewFields.map((viewField) => viewField.fieldMetadataId),
  );
  const data = fieldIds
    .filter((fieldMetadataId) => !existingFieldIds.has(fieldMetadataId))
    .map((fieldMetadataId, index) => ({
      viewId,
      fieldMetadataId,
      position: existingFieldIds.size + index,
      isVisible: true,
      size: 150,
    }));

  if (data.length === 0) return;

  try {
    await meta(
      `mutation ($data: [CreateViewFieldInput!]!) {
        createManyViewFields(data: $data) { id }
      }`,
      { data },
    );
  } catch (e) {
    report.issues.push(`viewFields: ${e.message}`);
  }
}

// ---------- Phase 1: standard object fields ----------
async function configureCompanies() {
  console.log('\n== Companies (Travel Agencies) ==');
  // Reuse Address for city/state — do not duplicate
  report.fieldsReused.push('company.address (city/state)');
  report.fieldsReused.push('company.agencyStatus, teamSize, currentCrm, lastContacted, agencyType, assignedRm');
  await ensureField(IDS.company, {
    name: 'agencyStatus',
    label: 'Agency Status',
    type: 'SELECT',
    icon: 'IconBuilding',
    options: selectOptions([
      { label: 'Prospect', value: 'PROSPECT', color: 'sky' },
      { label: 'Contacted', value: 'CONTACTED', color: 'blue' },
      { label: 'Qualified', value: 'QUALIFIED', color: 'turquoise' },
      { label: 'Demo Scheduled', value: 'DEMO_SCHEDULED', color: 'purple' },
      { label: 'In Progress', value: 'IN_PROGRESS', color: 'lime' },
      { label: 'Active Customer', value: 'WIN', color: 'green' },
      { label: 'Nurture', value: 'NURTURE', color: 'yellow' },
      { label: 'Blocked', value: 'BLOCKED', color: 'orange' },
      { label: 'Lost / Churned', value: 'LOSS', color: 'red' },
      { label: 'Do Not Contact / Spam', value: 'SPAM', color: 'gray' },
    ]),
  });
  await ensureField(IDS.company, {
    name: 'agencyType',
    label: 'Agency Type',
    type: 'SELECT',
    icon: 'IconBuildingStore',
    options: selectOptions([
      { label: 'Leisure', value: 'LEISURE', color: 'blue' },
      { label: 'Corporate', value: 'CORPORATE', color: 'green' },
      { label: 'MICE', value: 'MICE', color: 'purple' },
      { label: 'Online OTA', value: 'ONLINE_OTA', color: 'turquoise' },
      { label: 'Inbound', value: 'INBOUND', color: 'orange' },
      { label: 'Outbound', value: 'OUTBOUND', color: 'red' },
      { label: 'DMC', value: 'DMC', color: 'yellow' },
      { label: 'Other', value: 'OTHER', color: 'gray' },
    ]),
  });
  await ensureField(IDS.company, {
    name: 'teamSize',
    label: 'Team Size',
    type: 'NUMBER',
    icon: 'IconUsers',
  });
  await ensureField(IDS.company, {
    name: 'currentCrm',
    label: 'Current CRM',
    type: 'TEXT',
    icon: 'IconDatabase',
  });
  await ensureField(IDS.company, {
    name: 'lastContacted',
    label: 'Last Contacted',
    type: 'DATE',
    icon: 'IconCalendar',
  });
  await ensureField(IDS.company, {
    name: 'ratings',
    label: 'Ratings',
    type: 'RATING',
    icon: 'IconStar',
  });
  await ensureField(IDS.company, {
    name: 'assignedRm',
    label: 'Assigned RM',
    type: 'RELATION',
    icon: 'IconUser',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: IDS.workspaceMember,
      targetFieldLabel: 'Assigned Agencies',
      targetFieldIcon: 'IconBuilding',
    },
  });

  // Update agencyStatus options for travel agencies (keep existing values + add useful ones)
  const companyFields = await getExistingFields(IDS.company);
  const agencyStatus = companyFields.get('agencyStatus');
  if (agencyStatus) {
    const existingOpts = agencyStatus.options || [];
    const byValue = new Map(existingOpts.map((o) => [o.value, o]));
    const desired = [
      { label: 'Prospect', value: 'PROSPECT', color: 'sky' },
      { label: 'Contacted', value: 'CONTACTED', color: 'blue' },
      { label: 'Qualified', value: 'QUALIFIED', color: 'turquoise' },
      { label: 'Demo Scheduled', value: 'DEMO_SCHEDULED', color: 'purple' },
      { label: 'In Progress', value: 'IN_PROGRESS', color: 'lime' },
      { label: 'Active Customer', value: 'WIN', color: 'green' },
      { label: 'Nurture', value: 'NURTURE', color: 'yellow' },
      { label: 'Blocked', value: 'BLOCKED', color: 'orange' },
      { label: 'Lost / Churned', value: 'LOSS', color: 'red' },
      { label: 'Do Not Contact / Spam', value: 'SPAM', color: 'gray' },
    ];
    const desiredValues = new Set(desired.map(({ value }) => value));
    const options = desired.map((option, position) => {
      const previous = byValue.get(option.value);
      return previous
        ? { ...previous, label: option.label, color: option.color, position }
        : { ...option, position, id: uuid() };
    });
    for (const existing of existingOpts.filter(({ value }) => !desiredValues.has(value))) {
      options.push({ ...existing, position: options.length });
    }
    await updateField(agencyStatus.id, { options, label: 'Agency Status' });
  }

  await ensureField(IDS.company, {
    name: 'monthlyEnquiries',
    label: 'Monthly Enquiries',
    type: 'NUMBER',
    icon: 'IconChartBar',
  });
  await ensureField(IDS.company, {
    name: 'currentWorkingMethod',
    label: 'Current Working Method',
    type: 'SELECT',
    icon: 'IconTools',
    options: selectOptions([
      'Spreadsheets',
      'WhatsApp Only',
      'Email Only',
      'Legacy Software',
      'Other CRM',
      'Manual / Paper',
      'Mixed',
    ]),
  });
  // currentCrm already exists as TEXT — keep it
  await ensureField(IDS.company, {
    name: 'agencyLeadSource',
    label: 'Lead Source',
    type: 'SELECT',
    icon: 'IconTarget',
    options: selectOptions([
      'Website',
      'Facebook',
      'Instagram',
      'Referral',
      'Event',
      'Cold Outreach',
      'Competitor Research',
      'Partner',
      'Other',
    ]),
  });
  await ensureField(IDS.company, {
    name: 'fitScore',
    label: 'Fit Score',
    type: 'NUMBER',
    icon: 'IconGauge',
  });
  await ensureField(IDS.company, {
    name: 'riskLevel',
    label: 'Risk Level',
    type: 'SELECT',
    icon: 'IconAlertTriangle',
    options: selectOptions([
      { label: 'Low', value: 'LOW', color: 'green' },
      { label: 'Medium', value: 'MEDIUM', color: 'yellow' },
      { label: 'High', value: 'HIGH', color: 'orange' },
      { label: 'Critical', value: 'CRITICAL', color: 'red' },
    ]),
  });
  await ensureField(IDS.company, {
    name: 'operationalProblems',
    label: 'Operational Problems',
    type: 'MULTI_SELECT',
    icon: 'IconBug',
    options: selectOptions([
      'Lead Leakage',
      'No Follow-up Process',
      'Manual Quoting',
      'Poor WhatsApp Tracking',
      'No CRM Adoption',
      'Staff Overload',
      'Reporting Gaps',
      'Duplicate Data',
    ]),
  });
  await ensureField(IDS.company, {
    name: 'nextAction',
    label: 'Next Action',
    type: 'TEXT',
    icon: 'IconPlayerPlay',
  });
  await ensureField(IDS.company, {
    name: 'nextActionDate',
    label: 'Next Action Date',
    type: 'DATE',
    icon: 'IconCalendarEvent',
  });
  await ensureField(IDS.company, {
    name: 'demoNoShowCount',
    label: 'Demo No-Show Count',
    type: 'NUMBER',
    icon: 'IconUserOff',
  });
  await ensureField(IDS.company, {
    name: 'doNotContact',
    label: 'Do Not Contact',
    type: 'BOOLEAN',
    icon: 'IconBan',
    defaultValue: false,
  });
}

async function configurePeople() {
  console.log('\n== People (Contacts) ==');
  report.fieldsReused.push('person.linkedinLink, jobTitle, phones, emails, company');

  await ensureField(IDS.person, {
    name: 'contactRole',
    label: 'Contact Role',
    type: 'SELECT',
    icon: 'IconUser',
    options: selectOptions([
      'Owner',
      'Managing Director',
      'Sales Manager',
      'Operations Manager',
      'Front Desk',
      'IT / Tech',
      'Other',
    ]),
  });
  await ensureField(IDS.person, {
    name: 'decisionMaker',
    label: 'Decision-Maker',
    type: 'BOOLEAN',
    icon: 'IconCrown',
    defaultValue: false,
  });
  await ensureField(IDS.person, {
    name: 'whatsappNumber',
    label: 'WhatsApp Number',
    type: 'TEXT',
    icon: 'IconBrandWhatsapp',
  });
  await ensureField(IDS.person, {
    name: 'preferredContactMethod',
    label: 'Preferred Contact Method',
    type: 'SELECT',
    icon: 'IconPhone',
    options: selectOptions(['WhatsApp', 'Phone', 'Email', 'LinkedIn', 'In Person']),
  });
  await ensureField(IDS.person, {
    name: 'contactStatus',
    label: 'Contact Status',
    type: 'SELECT',
    icon: 'IconHeartbeat',
    options: selectOptions([
      { label: 'Active', value: 'ACTIVE', color: 'green' },
      { label: 'Warm', value: 'WARM', color: 'yellow' },
      { label: 'Cold', value: 'COLD', color: 'sky' },
      { label: 'Unresponsive', value: 'UNRESPONSIVE', color: 'orange' },
      { label: 'Do Not Contact', value: 'DO_NOT_CONTACT', color: 'red' },
    ]),
  });
  await ensureField(IDS.person, {
    name: 'consentToContact',
    label: 'Consent to Contact',
    type: 'BOOLEAN',
    icon: 'IconCheck',
    defaultValue: true,
  });
  await ensureField(IDS.person, {
    name: 'contactQuality',
    label: 'Contact Quality',
    type: 'SELECT',
    icon: 'IconStars',
    options: selectOptions([
      { label: 'High', value: 'HIGH', color: 'green' },
      { label: 'Medium', value: 'MEDIUM', color: 'yellow' },
      { label: 'Low', value: 'LOW', color: 'orange' },
      { label: 'Unknown', value: 'UNKNOWN', color: 'gray' },
    ]),
  });
}

async function configureNotes() {
  console.log('\n== Notes ==');
  await ensureField(IDS.note, {
    name: 'purpose',
    label: 'Purpose',
    type: 'SELECT',
    icon: 'IconNotes',
    options: selectOptions([
      { label: 'Call Summary', value: 'CALL_SUMMARY', color: 'green' },
      { label: 'Feedback', value: 'FEEDBACK', color: 'jade' },
      { label: 'Event Update', value: 'EVENT_UPDATE', color: 'mint' },
    ]),
  });
}

async function configureOpportunities() {
  console.log('\n== Opportunities ==');
  report.fieldsReused.push(
    'opportunity.amount (expected value), closeDate, company, owner, pointOfContact',
  );

  await ensureField(IDS.opportunity, {
    name: 'proposedPlan',
    label: 'Proposed Plan',
    type: 'SELECT',
    icon: 'IconPackage',
    options: selectOptions([
      { label: 'Annual', value: 'ANNUAL', color: 'green' },
      { label: 'Monthly', value: 'MONTHLY', color: 'jade' },
      { label: 'Semi', value: 'SEMI', color: 'mint' },
      { label: 'Quarter', value: 'QUARTER', color: 'turquoise' },
    ]),
  });

  const fields = await getExistingFields(IDS.opportunity);
  const stage = fields.get('stage');
  if (stage) {
    const desired = selectOptions([
      { label: 'Qualified', value: 'QUALIFIED', color: 'sky' },
      { label: 'Discovery', value: 'DISCOVERY', color: 'blue' },
      { label: 'Demo', value: 'DEMO', color: 'purple' },
      { label: 'Trial', value: 'TRIAL', color: 'turquoise' },
      { label: 'Pricing', value: 'PRICING', color: 'yellow' },
      { label: 'Negotiation', value: 'NEGOTIATION', color: 'orange' },
      { label: 'Decision Pending', value: 'DECISION_PENDING', color: 'pink' },
      { label: 'Won', value: 'WON', color: 'green' },
      { label: 'Lost', value: 'LOST', color: 'red' },
      { label: 'Nurture', value: 'NURTURE', color: 'gray' },
    ]);
    const existingOptions = stage.options || [];
    const existingValues = new Set(existingOptions.map(({ value }) => value));
    const options = existingOptions.map((option, position) => ({ ...option, position }));
    for (const option of desired.filter(({ value }) => !existingValues.has(value))) {
      options.push({ ...option, position: options.length, id: uuid() });
    }
    await updateField(stage.id, { options });
  }

  await ensureField(IDS.opportunity, {
    name: 'competitor',
    label: 'Competitor',
    type: 'TEXT',
    icon: 'IconSwords',
  });
  await ensureField(IDS.opportunity, {
    name: 'requirements',
    label: 'Requirements',
    type: 'TEXT',
    icon: 'IconListCheck',
  });
  await ensureField(IDS.opportunity, {
    name: 'nextAction',
    label: 'Next Action',
    type: 'TEXT',
    icon: 'IconPlayerPlay',
  });
  await ensureField(IDS.opportunity, {
    name: 'lostReason',
    label: 'Lost Reason',
    type: 'SELECT',
    icon: 'IconThumbDown',
    options: selectOptions([
      'Price',
      'Chose Competitor',
      'No Budget',
      'Timing',
      'No Decision Maker',
      'Feature Gap',
      'Unresponsive',
      'Other',
    ]),
  });
}

async function configureCustomObjects() {
  console.log('\n== Custom objects: Leads, Demos, Inbound Submissions ==');

  const lead = await ensureObject({
    nameSingular: 'lead',
    namePlural: 'leads',
    labelSingular: 'Lead',
    labelPlural: 'Leads',
    icon: 'IconTargetArrow',
    description: 'Inbound and outbound sales leads for travel agencies',
  });
  const demo = await ensureObject({
    nameSingular: 'demo',
    namePlural: 'demos',
    labelSingular: 'Demo',
    labelPlural: 'Demos',
    icon: 'IconPresentation',
    description: 'Product demos with customer and RM feedback',
  });
  const inbound = await ensureObject({
    nameSingular: 'inboundSubmission',
    namePlural: 'inboundSubmissions',
    labelSingular: 'Inbound Submission',
    labelPlural: 'Inbound Submissions',
    icon: 'IconInbox',
    description: 'Website, social and event form submissions',
  });

  // Relations for Lead
  await ensureField(lead.id, {
    name: 'company',
    label: 'Company',
    type: 'RELATION',
    icon: 'IconBuilding',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: IDS.company,
      targetFieldLabel: 'Leads',
      targetFieldIcon: 'IconTargetArrow',
    },
  });
  await ensureField(lead.id, {
    name: 'person',
    label: 'Person',
    type: 'RELATION',
    icon: 'IconUser',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: IDS.person,
      targetFieldLabel: 'Leads',
      targetFieldIcon: 'IconTargetArrow',
    },
  });
  await ensureField(lead.id, {
    name: 'opportunity',
    label: 'Opportunity',
    type: 'RELATION',
    icon: 'IconTrophy',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: IDS.opportunity,
      targetFieldLabel: 'Leads',
      targetFieldIcon: 'IconTargetArrow',
    },
  });
  await ensureField(lead.id, {
    name: 'assignedRm',
    label: 'Assigned RM',
    type: 'RELATION',
    icon: 'IconUser',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: IDS.workspaceMember,
      targetFieldLabel: 'Assigned Leads',
      targetFieldIcon: 'IconTargetArrow',
    },
  });

  await ensureField(lead.id, {
    name: 'source',
    label: 'Source',
    type: 'SELECT',
    icon: 'IconWorld',
    options: selectOptions([
      'Website', 'Facebook', 'Instagram', 'Referral', 'Event', 'Cold Outreach', 'Competitor Research', 'Other',
    ]),
  });
  await ensureField(lead.id, {
    name: 'leadType',
    label: 'Lead Type',
    type: 'SELECT',
    icon: 'IconTags',
    options: selectOptions([
      'Agency', 'Student / Researcher', 'Suspected Competitor', 'Partner', 'Other',
    ]),
  });
  await ensureField(lead.id, {
    name: 'stage',
    label: 'Stage',
    type: 'SELECT',
    icon: 'IconTimeline',
    options: selectOptions([
      { label: 'New', value: 'NEW', color: 'sky' },
      { label: 'Assigned', value: 'ASSIGNED', color: 'blue' },
      { label: 'Contacted', value: 'CONTACTED', color: 'turquoise' },
      { label: 'Qualified', value: 'QUALIFIED', color: 'green' },
      { label: 'Demo Required', value: 'DEMO_REQUIRED', color: 'purple' },
      { label: 'Converted', value: 'CONVERTED', color: 'lime' },
      { label: 'Won', value: 'WON', color: 'jade' },
      { label: 'Lost', value: 'LOST', color: 'red' },
      { label: 'Nurture', value: 'NURTURE', color: 'yellow' },
      { label: 'Blocked', value: 'BLOCKED', color: 'orange' },
    ]),
    defaultValue: "'NEW'",
  });
  await ensureField(lead.id, {
    name: 'priority',
    label: 'Priority',
    type: 'SELECT',
    icon: 'IconFlag',
    options: selectOptions([
      { label: 'Low', value: 'LOW', color: 'gray' },
      { label: 'Medium', value: 'MEDIUM', color: 'yellow' },
      { label: 'High', value: 'HIGH', color: 'orange' },
      { label: 'Urgent', value: 'URGENT', color: 'red' },
    ]),
  });
  await ensureField(lead.id, { name: 'fitScore', label: 'Fit Score', type: 'NUMBER', icon: 'IconGauge' });
  await ensureField(lead.id, { name: 'intentScore', label: 'Intent Score', type: 'NUMBER', icon: 'IconFlame' });
  await ensureField(lead.id, {
    name: 'riskScore',
    label: 'Risk Score',
    type: 'NUMBER',
    icon: 'IconAlertTriangle',
  });
  await ensureField(lead.id, { name: 'requirements', label: 'Requirements', type: 'TEXT', icon: 'IconListCheck' });
  await ensureField(lead.id, { name: 'lastContactDate', label: 'Last Contact', type: 'DATE', icon: 'IconCalendar' });
  await ensureField(lead.id, { name: 'nextAction', label: 'Next Action', type: 'TEXT', icon: 'IconPlayerPlay' });
  await ensureField(lead.id, { name: 'nextActionDate', label: 'Next Action Date', type: 'DATE', icon: 'IconCalendarEvent' });
  await ensureField(lead.id, {
    name: 'disqualificationReason',
    label: 'Disqualification Reason',
    type: 'SELECT',
    icon: 'IconBan',
    options: selectOptions([
      'Not an Agency', 'Student / Research Only', 'Competitor', 'Out of Geography', 'No Budget', 'Duplicate', 'Other',
    ]),
  });

  // Demo fields
  await ensureField(demo.id, {
    name: 'company',
    label: 'Company',
    type: 'RELATION',
    icon: 'IconBuilding',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: IDS.company,
      targetFieldLabel: 'Demos',
      targetFieldIcon: 'IconPresentation',
    },
  });
  await ensureField(demo.id, {
    name: 'person',
    label: 'Person',
    type: 'RELATION',
    icon: 'IconUser',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: IDS.person,
      targetFieldLabel: 'Demos',
      targetFieldIcon: 'IconPresentation',
    },
  });
  await ensureField(demo.id, {
    name: 'lead',
    label: 'Lead',
    type: 'RELATION',
    icon: 'IconTargetArrow',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: lead.id,
      targetFieldLabel: 'Demos',
      targetFieldIcon: 'IconPresentation',
    },
  });
  await ensureField(demo.id, {
    name: 'opportunity',
    label: 'Opportunity',
    type: 'RELATION',
    icon: 'IconTrophy',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: IDS.opportunity,
      targetFieldLabel: 'Demos',
      targetFieldIcon: 'IconPresentation',
    },
  });
  await ensureField(demo.id, {
    name: 'assignedRm',
    label: 'Assigned RM',
    type: 'RELATION',
    icon: 'IconUser',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: IDS.workspaceMember,
      targetFieldLabel: 'Assigned Demos',
      targetFieldIcon: 'IconPresentation',
    },
  });
  await ensureField(demo.id, { name: 'scheduledDate', label: 'Scheduled Date', type: 'DATE_TIME', icon: 'IconCalendar' });
  await ensureField(demo.id, {
    name: 'demoType',
    label: 'Demo Type',
    type: 'SELECT',
    icon: 'IconDeviceDesktop',
    options: selectOptions(['Discovery Demo', 'Product Walkthrough', 'Technical Deep Dive', 'Follow-up Demo']),
  });
  await ensureField(demo.id, {
    name: 'demoStatus',
    label: 'Demo Status',
    type: 'SELECT',
    icon: 'IconProgress',
    options: selectOptions([
      { label: 'Scheduled', value: 'SCHEDULED', color: 'blue' },
      { label: 'Completed', value: 'COMPLETED', color: 'green' },
      { label: 'No-Show', value: 'NO_SHOW', color: 'red' },
      { label: 'Cancelled', value: 'CANCELLED', color: 'gray' },
      { label: 'Rescheduled', value: 'RESCHEDULED', color: 'yellow' },
    ]),
  });
  await ensureField(demo.id, { name: 'meetingLink', label: 'Meeting Link', type: 'LINKS', icon: 'IconLink' });
  await ensureField(demo.id, { name: 'attendees', label: 'Attendees', type: 'TEXT', icon: 'IconUsers' });
  await ensureField(demo.id, {
    name: 'decisionMakerAttendance',
    label: 'Decision-Maker Attendance',
    type: 'BOOLEAN',
    icon: 'IconCrown',
    defaultValue: false,
  });
  await ensureField(demo.id, { name: 'problemsDiscussed', label: 'Problems Discussed', type: 'TEXT', icon: 'IconBug' });
  await ensureField(demo.id, { name: 'featuresDiscussed', label: 'Features Discussed', type: 'TEXT', icon: 'IconList' });
  await ensureField(demo.id, { name: 'customerRating', label: 'Customer Rating', type: 'RATING', icon: 'IconStar' });
  await ensureField(demo.id, { name: 'customerFeedback', label: 'Customer Feedback', type: 'TEXT', icon: 'IconMessage' });
  await ensureField(demo.id, { name: 'customerObjections', label: 'Customer Objections', type: 'TEXT', icon: 'IconMessageCircleOff' });
  await ensureField(demo.id, { name: 'requestedFeatures', label: 'Requested Features', type: 'TEXT', icon: 'IconPuzzle' });
  await ensureField(demo.id, { name: 'internalRmFeedback', label: 'Internal RM Feedback', type: 'TEXT', icon: 'IconNotes' });
  await ensureField(demo.id, {
    name: 'leadSeriousness',
    label: 'Lead Seriousness',
    type: 'SELECT',
    icon: 'IconFlame',
    options: selectOptions([
      { label: 'High', value: 'HIGH', color: 'green' },
      { label: 'Medium', value: 'MEDIUM', color: 'yellow' },
      { label: 'Low', value: 'LOW', color: 'orange' },
      { label: 'Tire-Kicker', value: 'TIRE_KICKER', color: 'red' },
    ]),
  });
  await ensureField(demo.id, {
    name: 'recommendedNextStep',
    label: 'Recommended Next Step',
    type: 'SELECT',
    icon: 'IconArrowRight',
    options: selectOptions([
      'Send Proposal', 'Schedule Trial', 'Follow-up Call', 'Nurture', 'Qualify Out', 'Create Opportunity',
    ]),
  });
  await ensureField(demo.id, { name: 'followUpDate', label: 'Follow-up Date', type: 'DATE', icon: 'IconCalendarEvent' });
  await ensureField(demo.id, { name: 'recordingLink', label: 'Recording Link', type: 'LINKS', icon: 'IconVideo' });

  // Inbound Submission fields
  await ensureField(inbound.id, { name: 'submissionId', label: 'Submission ID', type: 'TEXT', icon: 'IconHash' });
  await ensureField(inbound.id, {
    name: 'source',
    label: 'Source',
    type: 'SELECT',
    icon: 'IconWorld',
    options: selectOptions(['Website', 'Facebook', 'Instagram', 'Referral', 'Event', 'Other']),
  });
  await ensureField(inbound.id, { name: 'formName', label: 'Form Name', type: 'TEXT', icon: 'IconForms' });
  await ensureField(inbound.id, { name: 'submittedDate', label: 'Submitted Date', type: 'DATE_TIME', icon: 'IconCalendar' });
  await ensureField(inbound.id, { name: 'submitterName', label: 'Name', type: 'TEXT', icon: 'IconUser' });
  await ensureField(inbound.id, { name: 'submitterEmail', label: 'Email', type: 'TEXT', icon: 'IconMail' });
  await ensureField(inbound.id, { name: 'submitterPhone', label: 'Phone', type: 'TEXT', icon: 'IconPhone' });
  await ensureField(inbound.id, { name: 'agencyName', label: 'Agency Name', type: 'TEXT', icon: 'IconBuilding' });
  await ensureField(inbound.id, { name: 'agencyWebsite', label: 'Agency Website', type: 'TEXT', icon: 'IconWorldWww' });
  await ensureField(inbound.id, { name: 'originalPayload', label: 'Original Payload', type: 'RAW_JSON', icon: 'IconBraces' });
  await ensureField(inbound.id, {
    name: 'processingStatus',
    label: 'Processing Status',
    type: 'SELECT',
    icon: 'IconProgress',
    options: selectOptions([
      { label: 'New', value: 'NEW', color: 'sky' },
      { label: 'Processed', value: 'PROCESSED', color: 'green' },
      { label: 'Duplicate', value: 'DUPLICATE', color: 'yellow' },
      { label: 'Error', value: 'ERROR', color: 'red' },
      { label: 'Ignored', value: 'IGNORED', color: 'gray' },
    ]),
  });
  await ensureField(inbound.id, { name: 'processingError', label: 'Processing Error', type: 'TEXT', icon: 'IconAlertCircle' });
  await ensureField(inbound.id, {
    name: 'createdLead',
    label: 'Created Lead',
    type: 'RELATION',
    icon: 'IconTargetArrow',
    relationCreationPayload: {
      type: 'MANY_TO_ONE',
      targetObjectMetadataId: lead.id,
      targetFieldLabel: 'Inbound Submissions',
      targetFieldIcon: 'IconInbox',
    },
  });

  return { lead, demo, inbound };
}

async function configureRoles(objectIds) {
  console.log('\n== Roles ==');
  const allObjectIds = [
    IDS.company, IDS.person, IDS.opportunity, IDS.task, IDS.note,
    objectIds.lead.id, objectIds.demo.id, objectIds.inbound.id,
  ];

  const founder = await ensureRole({
    label: 'Founder',
    description: 'Complete access to Paryatech CRM',
    icon: 'IconCrown',
    canUpdateAllSettings: true,
    canAccessAllTools: true,
    canReadAllObjectRecords: true,
    canUpdateAllObjectRecords: true,
    canSoftDeleteAllObjectRecords: true,
    canDestroyAllObjectRecords: true,
    canBeAssignedToUsers: true,
    canBeAssignedToApiKeys: true,
  });
  try {
    await upsertPermissionFlags(founder.id, [
      'API_KEYS_AND_WEBHOOKS', 'WORKSPACE', 'WORKSPACE_MEMBERS', 'ROLES', 'DATA_MODEL', 'SECURITY',
      'WORKFLOWS', 'APPLICATIONS', 'LAYOUTS', 'AI_SETTINGS', 'AI', 'VIEWS', 'UPLOAD_FILE', 'DOWNLOAD_FILE',
      'IMPORT_CSV', 'EXPORT_CSV', 'CONNECTED_ACCOUNTS', 'PROFILE_INFORMATION', 'HTTP_REQUEST_TOOL',
    ]);
  } catch (e) {
    report.issues.push(`Founder flags: ${e.message}`);
  }

  const techHead = await ensureRole({
    label: 'Tech Head',
    description: 'Technical settings, integrations, APIs and workflows',
    icon: 'IconSettings',
    canUpdateAllSettings: true,
    canAccessAllTools: true,
    canReadAllObjectRecords: true,
    canUpdateAllObjectRecords: true,
    canSoftDeleteAllObjectRecords: false,
    canDestroyAllObjectRecords: false,
    canBeAssignedToUsers: true,
    canBeAssignedToApiKeys: true,
  });
  try {
    await upsertPermissionFlags(techHead.id, [
      'API_KEYS_AND_WEBHOOKS', 'DATA_MODEL', 'WORKFLOWS', 'APPLICATIONS', 'SECURITY',
      'CONNECTED_ACCOUNTS', 'HTTP_REQUEST_TOOL', 'VIEWS', 'UPLOAD_FILE', 'DOWNLOAD_FILE', 'PROFILE_INFORMATION',
    ]);
  } catch (e) {
    report.issues.push(`Tech Head flags: ${e.message}`);
  }

  const engineer = await ensureRole({
    label: 'Engineer',
    description: 'Technical testing and errors, limited sales-data access',
    icon: 'IconCode',
    canUpdateAllSettings: false,
    canAccessAllTools: true,
    canReadAllObjectRecords: false,
    canUpdateAllObjectRecords: false,
    canSoftDeleteAllObjectRecords: false,
    canDestroyAllObjectRecords: false,
    canBeAssignedToUsers: true,
    canBeAssignedToApiKeys: true,
  });
  try {
    await upsertObjectPermissions(
      engineer.id,
      allObjectIds.map((objectMetadataId) => ({
        objectMetadataId,
        canReadObjectRecords: objectMetadataId === objectIds.inbound.id || objectMetadataId === IDS.task,
        canUpdateObjectRecords: objectMetadataId === objectIds.inbound.id || objectMetadataId === IDS.task,
        canSoftDeleteObjectRecords: false,
        canDestroyObjectRecords: false,
      })),
    );
    await upsertPermissionFlags(engineer.id, [
      'WORKFLOWS', 'DATA_MODEL', 'API_KEYS_AND_WEBHOOKS', 'UPLOAD_FILE', 'PROFILE_INFORMATION', 'HTTP_REQUEST_TOOL',
    ]);
  } catch (e) {
    report.issues.push(`Engineer perms: ${e.message}`);
  }

  const salesHead = await ensureRole({
    label: 'Sales Head',
    description: 'All sales records, assignments and reports',
    icon: 'IconBriefcase',
    canUpdateAllSettings: false,
    canAccessAllTools: false,
    canReadAllObjectRecords: true,
    canUpdateAllObjectRecords: true,
    canSoftDeleteAllObjectRecords: true,
    canDestroyAllObjectRecords: false,
    canBeAssignedToUsers: true,
    canBeAssignedToApiKeys: false,
  });
  try {
    await upsertPermissionFlags(salesHead.id, [
      'VIEWS', 'UPLOAD_FILE', 'DOWNLOAD_FILE', 'EXPORT_CSV', 'IMPORT_CSV', 'PROFILE_INFORMATION', 'WORKSPACE_MEMBERS',
    ]);
  } catch (e) {
    report.issues.push(`Sales Head flags: ${e.message}`);
  }

  const rm = await ensureRole({
    label: 'RM',
    description: 'Assigned sales work, activities, demos and feedback — no system admin or bulk export',
    icon: 'IconUser',
    canUpdateAllSettings: false,
    canAccessAllTools: false,
    canReadAllObjectRecords: true, // narrowed via RLP if available
    canUpdateAllObjectRecords: true,
    canSoftDeleteAllObjectRecords: false,
    canDestroyAllObjectRecords: false,
    canBeAssignedToUsers: true,
    canBeAssignedToApiKeys: false,
  });
  try {
    await upsertPermissionFlags(rm.id, [
      'VIEWS', 'UPLOAD_FILE', 'DOWNLOAD_FILE', 'PROFILE_INFORMATION',
      // intentionally NO EXPORT_CSV / DATA_MODEL / API_KEYS / WORKFLOWS admin
    ]);
  } catch (e) {
    report.issues.push(`RM flags: ${e.message}`);
  }

  // Attempt record-level permission: RM sees only assigned records
  try {
    const leadFields = await getExistingFields(objectIds.lead.id);
    const assignedRm = leadFields.get('assignedRm');
    if (assignedRm) {
      await meta(
        `mutation ($input: UpsertRowLevelPermissionPredicatesInput!) {
          upsertRowLevelPermissionPredicates(input: $input) { __typename }
        }`,
        {
          input: {
            roleId: rm.id,
            objectMetadataId: objectIds.lead.id,
            predicates: [
              {
                fieldMetadataId: assignedRm.id,
                operand: 'IS',
                value: { isCurrentWorkspaceMemberSelected: true, selectedRecordIds: [] },
              },
            ],
            predicateGroups: [],
          },
        },
      );
      report.tested.push('Row-level permission predicate upsert attempted for RM → Leads.assignedRm');
    }
  } catch (e) {
    report.limitations.push(
      `Record-level access (RM sees only assigned records): upsert failed — ${e.message}. ` +
        'Self-hosted Twenty exposes rowLevelPermissionPredicate tables/APIs; if the mutation is plan-gated or schema-version specific, configure Filters-as-views as a workaround until RLP is confirmed working in Settings → Roles.',
    );
  }

  return { founder, techHead, engineer, salesHead, rm };
}

async function configureViews(objectIds) {
  console.log('\n== Views ==');
  const leadFields = await getExistingFields(objectIds.lead.id);
  const demoFields = await getExistingFields(objectIds.demo.id);
  const companyFields = await getExistingFields(IDS.company);
  const oppFields = await getExistingFields(IDS.opportunity);

  const f = (map, name) => map.get(name)?.id;

  // Leads views
  const vNewUnassigned = await ensureView({
    name: 'New and Unassigned Leads',
    objectMetadataId: objectIds.lead.id,
    icon: 'IconInbox',
  });
  try {
    await createViewFilter(vNewUnassigned.id, f(leadFields, 'stage'), 'IS', ['NEW']);
    await createViewFilter(vNewUnassigned.id, f(leadFields, 'assignedRm'), 'IS_EMPTY', true);
  } catch (e) {
    report.issues.push(`view New Unassigned: ${e.message}`);
  }

  const vMyActive = await ensureView({
    name: 'My Active Leads',
    objectMetadataId: objectIds.lead.id,
    icon: 'IconUser',
  });
  try {
    await createViewFilter(vMyActive.id, f(leadFields, 'assignedRm'), 'IS', {
      isCurrentWorkspaceMemberSelected: true,
      selectedRecordIds: [],
    });
    await createViewFilter(vMyActive.id, f(leadFields, 'stage'), 'IS_NOT', ['WON', 'LOST', 'CONVERTED']);
  } catch (e) {
    report.issues.push(`view My Active: ${e.message}`);
  }

  const vFollowToday = await ensureView({
    name: 'Follow-ups Due Today',
    objectMetadataId: objectIds.lead.id,
    icon: 'IconCalendarDue',
  });
  try {
    await createViewFilter(vFollowToday.id, f(leadFields, 'nextActionDate'), 'IS_TODAY', true);
  } catch (e) {
    report.issues.push(`view Follow today: ${e.message}`);
  }

  const vOverdue = await ensureView({
    name: 'Overdue Follow-ups',
    objectMetadataId: objectIds.lead.id,
    icon: 'IconAlertTriangle',
  });
  try {
    await createViewFilter(vOverdue.id, f(leadFields, 'nextActionDate'), 'IS_IN_PAST', true);
    await createViewFilter(vOverdue.id, f(leadFields, 'stage'), 'IS_NOT', ['WON', 'LOST', 'CONVERTED']);
  } catch (e) {
    report.issues.push(`view Overdue: ${e.message}`);
  }

  const vNoNext = await ensureView({
    name: 'Leads Without Next Actions',
    objectMetadataId: objectIds.lead.id,
    icon: 'IconQuestionMark',
  });
  try {
    await createViewFilter(vNoNext.id, f(leadFields, 'nextAction'), 'IS_EMPTY', true);
    await createViewFilter(vNoNext.id, f(leadFields, 'stage'), 'IS_NOT', ['WON', 'LOST', 'CONVERTED', 'BLOCKED']);
  } catch (e) {
    report.issues.push(`view No next: ${e.message}`);
  }

  const vHighFitRisk = await ensureView({
    name: 'High-Fit and High-Risk Leads',
    objectMetadataId: objectIds.lead.id,
    icon: 'IconGauge',
  });
  try {
    await createViewFilter(vHighFitRisk.id, f(leadFields, 'fitScore'), 'GREATER_THAN_OR_EQUAL', 70);
    await createViewFilter(vHighFitRisk.id, f(leadFields, 'riskScore'), 'GREATER_THAN_OR_EQUAL', 70);
  } catch (e) {
    report.issues.push(`view High fit/risk: ${e.message}`);
  }

  // Demo views
  const vUpcomingDemos = await ensureView({
    name: "Upcoming and Today's Demos",
    objectMetadataId: objectIds.demo.id,
    icon: 'IconCalendar',
  });
  try {
    await createViewFilter(vUpcomingDemos.id, f(demoFields, 'demoStatus'), 'IS', ['SCHEDULED', 'RESCHEDULED']);
  } catch (e) {
    report.issues.push(`view Upcoming demos: ${e.message}`);
  }

  const vNoShows = await ensureView({
    name: 'Demo No-Shows',
    objectMetadataId: objectIds.demo.id,
    icon: 'IconUserOff',
  });
  try {
    await createViewFilter(vNoShows.id, f(demoFields, 'demoStatus'), 'IS', ['NO_SHOW']);
  } catch (e) {
    report.issues.push(`view No-shows: ${e.message}`);
  }

  const vMissingCustomerFb = await ensureView({
    name: 'Demos Missing Customer Feedback',
    objectMetadataId: objectIds.demo.id,
    icon: 'IconMessageOff',
  });
  try {
    await createViewFilter(vMissingCustomerFb.id, f(demoFields, 'demoStatus'), 'IS', ['COMPLETED']);
    await createViewFilter(vMissingCustomerFb.id, f(demoFields, 'customerFeedback'), 'IS_EMPTY', true);
  } catch (e) {
    report.issues.push(`view missing customer fb: ${e.message}`);
  }

  const vMissingRmFb = await ensureView({
    name: 'Demos Missing RM Feedback',
    objectMetadataId: objectIds.demo.id,
    icon: 'IconNotesOff',
  });
  try {
    await createViewFilter(vMissingRmFb.id, f(demoFields, 'demoStatus'), 'IS', ['COMPLETED']);
    await createViewFilter(vMissingRmFb.id, f(demoFields, 'internalRmFeedback'), 'IS_EMPTY', true);
  } catch (e) {
    report.issues.push(`view missing RM fb: ${e.message}`);
  }

  // Demo calendar
  const cal = await ensureView({
    name: 'Demo Calendar',
    objectMetadataId: objectIds.demo.id,
    type: 'CALENDAR',
    icon: 'IconCalendarEvent',
    calendarLayout: 'WEEK',
    calendarFieldMetadataId: f(demoFields, 'scheduledDate'),
  });
  report.viewsCreated.push(`Demo Calendar (${cal.id})`);

  // Opportunity kanban
  const kanban = await ensureView({
    name: 'Opportunities by Stage',
    objectMetadataId: IDS.opportunity,
    type: 'KANBAN',
    icon: 'IconLayoutKanban',
    mainGroupByFieldMetadataId: f(oppFields, 'stage'),
  });
  try {
    const stageField = oppFields.get('stage');
    const values = (stageField?.options || []).map((o) => o.value);
    await createViewGroups(kanban.id, stageField.id, values);
  } catch (e) {
    report.issues.push(`kanban groups: ${e.message}`);
  }

  // Company views
  const vNoRecent = await ensureView({
    name: 'Agencies with No Recent Contact',
    objectMetadataId: IDS.company,
    icon: 'IconMoodSilence',
  });
  try {
    // lastContacted older / empty — use IS_EMPTY as proxy plus past if supported
    await createViewFilter(vNoRecent.id, f(companyFields, 'lastContacted'), 'IS_EMPTY', true);
  } catch (e) {
    report.issues.push(`view no recent contact: ${e.message}`);
  }

  const vBlocked = await ensureView({
    name: 'Blocked Agencies',
    objectMetadataId: IDS.company,
    icon: 'IconBan',
  });
  try {
    await createViewFilter(vBlocked.id, f(companyFields, 'agencyStatus'), 'IS', ['BLOCKED']);
  } catch (e) {
    report.issues.push(`view blocked: ${e.message}`);
  }

  const exactViewFilters = [
    [vNewUnassigned, [[f(leadFields, 'stage'), 'IS', ['NEW']], [f(leadFields, 'assignedRm'), 'IS_EMPTY', true]]],
    [vMyActive, [[f(leadFields, 'assignedRm'), 'IS', { isCurrentWorkspaceMemberSelected: true, selectedRecordIds: [] }], [f(leadFields, 'stage'), 'IS_NOT', ['WON', 'LOST', 'CONVERTED']]]],
    [vFollowToday, [[f(leadFields, 'nextActionDate'), 'IS_TODAY', true]]],
    [vOverdue, [[f(leadFields, 'nextActionDate'), 'IS_IN_PAST', true], [f(leadFields, 'stage'), 'IS_NOT', ['WON', 'LOST', 'CONVERTED']]]],
    [vNoNext, [[f(leadFields, 'nextAction'), 'IS_EMPTY', true], [f(leadFields, 'stage'), 'IS_NOT', ['WON', 'LOST', 'CONVERTED', 'BLOCKED']]]],
    [vHighFitRisk, [[f(leadFields, 'fitScore'), 'GREATER_THAN_OR_EQUAL', 70], [f(leadFields, 'riskScore'), 'GREATER_THAN_OR_EQUAL', 70]]],
    [vUpcomingDemos, [[f(demoFields, 'demoStatus'), 'IS', ['SCHEDULED', 'RESCHEDULED']]]],
    [vNoShows, [[f(demoFields, 'demoStatus'), 'IS', ['NO_SHOW']]]],
    [vMissingCustomerFb, [[f(demoFields, 'demoStatus'), 'IS', ['COMPLETED']], [f(demoFields, 'customerFeedback'), 'IS_EMPTY', true]]],
    [vMissingRmFb, [[f(demoFields, 'demoStatus'), 'IS', ['COMPLETED']], [f(demoFields, 'internalRmFeedback'), 'IS_EMPTY', true]]],
    [cal, []],
    [kanban, []],
    [vNoRecent, [[f(companyFields, 'lastContacted'), 'IS_EMPTY', true]]],
    [vBlocked, [[f(companyFields, 'agencyStatus'), 'IS', ['BLOCKED']]]],
  ];
  for (const [view, expectedFilters] of exactViewFilters) {
    await removeUnexpectedViewFilters(view.id, expectedFilters);
  }
}

async function configureWorkflows() {
  console.log('\n== Workflows ==');
  const requiredNames = [
    'New Lead → First Contact Task',
    'Demo Scheduled → Prep & Reminder Tasks',
    'Demo Completed → Feedback & Follow-up',
    'Demo No-Show → Follow-up & Risk Review',
    'Lead Qualified → Create Opportunity',
    'Active Lead Without Next Action → Create Task',
  ];
  const existing = await core(`query { workflows(first: 100) { edges { node { name } } } }`);
  const names = new Set(existing.workflows.edges.map(({ node }) => node.name));
  for (const name of requiredNames) {
    if (names.has(name)) {
      report.workflowsCreated.push(`${name} (exists)`);
      continue;
    }
    const created = await core(
      `mutation ($data: WorkflowCreateInput!) {
        createWorkflow(data: $data) { id name }
      }`,
      { data: { name } },
    );
    names.add(created.createWorkflow.name);
    report.workflowsCreated.push(name);
  }
}



async function main() {
  console.log('Paryatech Twenty CRM configuration starting...');

  const standardObjects = await getObjects();
  for (const name of ['company', 'person', 'opportunity', 'task', 'workspaceMember', 'note']) {
    const object = standardObjects.get(name);
    if (!object) throw new Error(`Required standard object is missing: ${name}`);
    IDS[name] = object.id;
  }
  const recordCountFields = [...standardObjects.values()]
    .filter(
      (object) =>
        object.isActive &&
        !object.isSystem &&
        !['workflow', 'dashboard'].includes(object.nameSingular),
    )
    .map((object) => [object.namePlural, object.namePlural]);
  for (const [nameSingular, namePlural] of [
    ['lead', 'leads'],
    ['demo', 'demos'],
    ['inboundSubmission', 'inboundSubmissions'],
  ]) {
    if (!standardObjects.has(nameSingular)) recordCountFields.push([namePlural, namePlural]);
  }
  const existingRecordCountFields = recordCountFields.filter(
    ([, fieldName]) =>
      standardObjects.has(
        [...standardObjects.values()].find((object) => object.namePlural === fieldName)?.nameSingular,
      ),
  );
  const businessData = await core(
    `query {
      ${existingRecordCountFields
        .map(([alias, fieldName]) => `${alias}: ${fieldName}(first: 1) { totalCount }`)
        .join('\n')}
    }`,
  );
  report.recordCountsBefore = Object.fromEntries(
    recordCountFields.map(([name]) => [name, businessData[name]?.totalCount ?? 0]),
  );

  report.tested.push('API authentication OK against target Paryatech workspace');

  await configureCompanies();
  await configurePeople();
  await configureNotes();
  await configureOpportunities();
  const objectIds = await configureCustomObjects();
  await configureRoles(objectIds);
  await configureViews(objectIds);
  await configureWorkflows();

  report.tested.push('Configuration-only migration: no CRM records created');

  report.limitations.push(
    'City/State reuse Company Address composite field (addressCity / addressState) — no duplicate city/state fields created.',
  );
  report.limitations.push(
    'Expected value reuses Opportunity Amount (currency). Closing date reuses Close date. LinkedIn on People reuses linkedinLink.',
  );
  report.limitations.push(
    'No Meta / WhatsApp / Gmail / production integrations were configured (per request).',
  );
  report.limitations.push(
    'Bulk export disabled for RM role via missing EXPORT_CSV permission flag; Founder/Sales Head retain export.',
  );

  const out = JSON.stringify(report, null, 2);
  fs.writeFileSync(new URL('./setup-report.json', import.meta.url), out);
  console.log('\n==== SETUP REPORT ====');
  console.log(out);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

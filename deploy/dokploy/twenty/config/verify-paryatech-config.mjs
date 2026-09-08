#!/usr/bin/env node
import fs from 'node:fs';


const BASE = (process.env.TWENTY_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = (process.env.TWENTY_TOKEN || '').trim();

if (!TOKEN) {
  throw new Error('Set TWENTY_TOKEN to a target workspace access token.');
}

async function gql(endpoint, query, variables = {}) {
  const response = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    const details = body.errors?.map(({ message }) => message).join('; ') || `${response.status} ${response.statusText}`;
    throw new Error(`${endpoint}: ${details}`);
  }
  return body.data;
}

const requiredFields = {
  company: [
    'agencyStatus', 'agencyType', 'teamSize', 'currentCrm', 'lastContacted', 'ratings',
    'assignedRm', 'monthlyEnquiries', 'currentWorkingMethod', 'agencyLeadSource', 'fitScore',
    'riskLevel', 'operationalProblems', 'nextAction', 'nextActionDate', 'demoNoShowCount',
    'doNotContact',
  ],
  person: [
    'contactRole', 'decisionMaker', 'whatsappNumber', 'preferredContactMethod',
    'contactStatus', 'consentToContact', 'contactQuality',
  ],
  opportunity: ['proposedPlan', 'competitor', 'requirements', 'nextAction', 'lostReason'],
  note: ['purpose'],
  lead: [
    'company', 'person', 'opportunity', 'assignedRm', 'source', 'leadType', 'stage', 'priority',
    'fitScore', 'intentScore', 'riskScore', 'requirements', 'lastContactDate', 'nextAction',
    'nextActionDate', 'disqualificationReason',
  ],
  demo: [
    'company', 'person', 'lead', 'opportunity', 'assignedRm', 'scheduledDate', 'demoType',
    'demoStatus', 'meetingLink', 'attendees', 'decisionMakerAttendance', 'problemsDiscussed',
    'featuresDiscussed', 'customerRating', 'customerFeedback', 'customerObjections',
    'requestedFeatures', 'internalRmFeedback', 'leadSeriousness', 'recommendedNextStep',
    'followUpDate', 'recordingLink',
  ],
  inboundSubmission: [
    'submissionId', 'source', 'formName', 'submittedDate', 'submitterName', 'submitterEmail',
    'submitterPhone', 'agencyName', 'agencyWebsite', 'originalPayload', 'processingStatus',
    'processingError', 'createdLead',
  ],
};

const requiredFieldTypes = {
  'company.agencyStatus': 'SELECT',
  'company.agencyType': 'SELECT',
  'company.teamSize': 'NUMBER',
  'company.currentCrm': 'TEXT',
  'company.lastContacted': 'DATE',
  'company.ratings': 'RATING',
  'company.assignedRm': 'RELATION',
  'company.monthlyEnquiries': 'NUMBER',
  'company.currentWorkingMethod': 'SELECT',
  'company.agencyLeadSource': 'SELECT',
  'company.fitScore': 'NUMBER',
  'company.riskLevel': 'SELECT',
  'company.operationalProblems': 'MULTI_SELECT',
  'company.nextAction': 'TEXT',
  'company.nextActionDate': 'DATE',
  'company.demoNoShowCount': 'NUMBER',
  'company.doNotContact': 'BOOLEAN',
  'person.contactRole': 'SELECT',
  'person.decisionMaker': 'BOOLEAN',
  'person.whatsappNumber': 'TEXT',
  'person.preferredContactMethod': 'SELECT',
  'person.contactStatus': 'SELECT',
  'person.consentToContact': 'BOOLEAN',
  'person.contactQuality': 'SELECT',
  'opportunity.proposedPlan': 'SELECT',
  'opportunity.competitor': 'TEXT',
  'opportunity.requirements': 'TEXT',
  'opportunity.nextAction': 'TEXT',
  'opportunity.lostReason': 'SELECT',
  'note.purpose': 'SELECT',
  'lead.company': 'RELATION',
  'lead.person': 'RELATION',
  'lead.opportunity': 'RELATION',
  'lead.assignedRm': 'RELATION',
  'lead.source': 'SELECT',
  'lead.leadType': 'SELECT',
  'lead.stage': 'SELECT',
  'lead.priority': 'SELECT',
  'lead.fitScore': 'NUMBER',
  'lead.intentScore': 'NUMBER',
  'lead.riskScore': 'NUMBER',
  'lead.requirements': 'TEXT',
  'lead.lastContactDate': 'DATE',
  'lead.nextAction': 'TEXT',
  'lead.nextActionDate': 'DATE',
  'lead.disqualificationReason': 'SELECT',
  'demo.company': 'RELATION',
  'demo.person': 'RELATION',
  'demo.lead': 'RELATION',
  'demo.opportunity': 'RELATION',
  'demo.assignedRm': 'RELATION',
  'demo.scheduledDate': 'DATE_TIME',
  'demo.demoType': 'SELECT',
  'demo.demoStatus': 'SELECT',
  'demo.meetingLink': 'LINKS',
  'demo.attendees': 'TEXT',
  'demo.decisionMakerAttendance': 'BOOLEAN',
  'demo.problemsDiscussed': 'TEXT',
  'demo.featuresDiscussed': 'TEXT',
  'demo.customerRating': 'RATING',
  'demo.customerFeedback': 'TEXT',
  'demo.customerObjections': 'TEXT',
  'demo.requestedFeatures': 'TEXT',
  'demo.internalRmFeedback': 'TEXT',
  'demo.leadSeriousness': 'SELECT',
  'demo.recommendedNextStep': 'SELECT',
  'demo.followUpDate': 'DATE',
  'demo.recordingLink': 'LINKS',
  'inboundSubmission.submissionId': 'TEXT',
  'inboundSubmission.source': 'SELECT',
  'inboundSubmission.formName': 'TEXT',
  'inboundSubmission.submittedDate': 'DATE_TIME',
  'inboundSubmission.submitterName': 'TEXT',
  'inboundSubmission.submitterEmail': 'TEXT',
  'inboundSubmission.submitterPhone': 'TEXT',
  'inboundSubmission.agencyName': 'TEXT',
  'inboundSubmission.agencyWebsite': 'TEXT',
  'inboundSubmission.originalPayload': 'RAW_JSON',
  'inboundSubmission.processingStatus': 'SELECT',
  'inboundSubmission.processingError': 'TEXT',
  'inboundSubmission.createdLead': 'RELATION',
};

const requiredRelationTargets = {
  'company.assignedRm': 'workspaceMember',
  'lead.company': 'company',
  'lead.person': 'person',
  'lead.opportunity': 'opportunity',
  'lead.assignedRm': 'workspaceMember',
  'demo.company': 'company',
  'demo.person': 'person',
  'demo.lead': 'lead',
  'demo.opportunity': 'opportunity',
  'demo.assignedRm': 'workspaceMember',
  'inboundSubmission.createdLead': 'lead',
};

const requiredOptionValues = {
  'company.agencyStatus': ['PROSPECT', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'IN_PROGRESS', 'WIN', 'NURTURE', 'BLOCKED', 'LOSS', 'SPAM'],
  'company.agencyType': ['LEISURE', 'CORPORATE', 'MICE', 'ONLINE_OTA', 'INBOUND', 'OUTBOUND', 'DMC', 'OTHER'],
  'company.currentWorkingMethod': ['SPREADSHEETS', 'WHATSAPP_ONLY', 'EMAIL_ONLY', 'LEGACY_SOFTWARE', 'OTHER_CRM', 'MANUAL_PAPER', 'MIXED'],
  'company.riskLevel': ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
  'opportunity.proposedPlan': ['ANNUAL', 'MONTHLY', 'SEMI', 'QUARTER'],
  'note.purpose': ['CALL_SUMMARY', 'FEEDBACK', 'EVENT_UPDATE'],
  'lead.stage': ['NEW', 'ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DEMO_REQUIRED', 'CONVERTED', 'WON', 'LOST', 'NURTURE', 'BLOCKED'],
  'lead.priority': ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
  'demo.demoStatus': ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED'],
  'demo.leadSeriousness': ['HIGH', 'MEDIUM', 'LOW', 'TIRE_KICKER'],
  'inboundSubmission.processingStatus': ['NEW', 'PROCESSED', 'DUPLICATE', 'ERROR', 'IGNORED'],
};

const requiredRoles = {
  Founder: {
    base: [true, true, true, true, true, true, true, true],
    flags: ['WORKFLOWS', 'DATA_MODEL', 'ROLES', 'SECURITY', 'EXPORT_CSV'],
  },
  'Tech Head': {
    base: [true, true, true, true, false, false, true, true],
    flags: ['WORKFLOWS', 'DATA_MODEL', 'API_KEYS_AND_WEBHOOKS', 'SECURITY'],
  },
  Engineer: {
    base: [false, true, false, false, false, false, true, true],
    flags: ['WORKFLOWS', 'DATA_MODEL', 'API_KEYS_AND_WEBHOOKS'],
    forbiddenFlags: ['EXPORT_CSV', 'ROLES', 'SECURITY'],
  },
  'Sales Head': {
    base: [false, false, true, true, true, false, true, false],
    flags: ['VIEWS', 'EXPORT_CSV', 'IMPORT_CSV'],
    forbiddenFlags: ['DATA_MODEL', 'ROLES', 'SECURITY'],
  },
  RM: {
    base: [false, false, true, true, false, false, true, false],
    flags: ['VIEWS', 'UPLOAD_FILE', 'DOWNLOAD_FILE', 'PROFILE_INFORMATION'],
    forbiddenFlags: ['EXPORT_CSV', 'DATA_MODEL', 'API_KEYS_AND_WEBHOOKS', 'WORKFLOWS', 'ROLES'],
  },
};

const requiredViews = [
  'New and Unassigned Leads',
  'My Active Leads',
  'Follow-ups Due Today',
  'Overdue Follow-ups',
  'Leads Without Next Actions',
  'High-Fit and High-Risk Leads',
  "Upcoming and Today's Demos",
  'Demo No-Shows',
  'Demos Missing Customer Feedback',
  'Demos Missing RM Feedback',
  'Demo Calendar',
  'Opportunities by Stage',
  'Agencies with No Recent Contact',
  'Blocked Agencies',
  'Qualified Leads',
  'Leads Requiring Demo',
  'Unassigned Active Leads',
  'Hot Leads',
  'Nurture Leads',
  'Demo Follow-ups Due Today',
  'High-Seriousness Completed Demos',
  'Won Opportunities',
  'Lost Opportunities',
  'Decision-Pending Opportunities',
  'High-Risk Agencies',
  'Do Not Contact Agencies',
  'Agencies by Status',
];

const requiredViewModels = {
  lead: [
    'New and Unassigned Leads', 'My Active Leads', 'Follow-ups Due Today',
    'Overdue Follow-ups', 'Leads Without Next Actions', 'High-Fit and High-Risk Leads',
    'Qualified Leads', 'Leads Requiring Demo', 'Unassigned Active Leads', 'Hot Leads',
    'Nurture Leads',
  ],
  demo: [
    "Upcoming and Today's Demos", 'Demo No-Shows', 'Demos Missing Customer Feedback',
    'Demos Missing RM Feedback', 'Demo Calendar', 'Demo Follow-ups Due Today',
    'High-Seriousness Completed Demos',
  ],
  opportunity: [
    'Opportunities by Stage', 'Won Opportunities', 'Lost Opportunities',
    'Decision-Pending Opportunities',
  ],
  company: [
    'Agencies with No Recent Contact', 'Blocked Agencies', 'High-Risk Agencies',
    'Do Not Contact Agencies', 'Agencies by Status',
  ],
};

const requiredViewTypes = {
  'Demo Calendar': 'CALENDAR',
  'Opportunities by Stage': 'KANBAN',
  'Agencies by Status': 'KANBAN',
};

const requiredViewFilters = {
  'New and Unassigned Leads': [['lead.stage', 'IS', ['NEW']], ['lead.assignedRm', 'IS_EMPTY', true]],
  'My Active Leads': [['lead.assignedRm', 'IS', { isCurrentWorkspaceMemberSelected: true, selectedRecordIds: [] }], ['lead.stage', 'IS_NOT', ['WON', 'LOST', 'CONVERTED']]],
  'Follow-ups Due Today': [['lead.nextActionDate', 'IS_TODAY', true]],
  'Overdue Follow-ups': [['lead.nextActionDate', 'IS_IN_PAST', true], ['lead.stage', 'IS_NOT', ['WON', 'LOST', 'CONVERTED']]],
  'Leads Without Next Actions': [['lead.nextAction', 'IS_EMPTY', true], ['lead.stage', 'IS_NOT', ['WON', 'LOST', 'CONVERTED', 'BLOCKED']]],
  'High-Fit and High-Risk Leads': [['lead.fitScore', 'GREATER_THAN_OR_EQUAL', 70], ['lead.riskScore', 'GREATER_THAN_OR_EQUAL', 70]],
  "Upcoming and Today's Demos": [['demo.demoStatus', 'IS', ['SCHEDULED', 'RESCHEDULED']]],
  'Demo No-Shows': [['demo.demoStatus', 'IS', ['NO_SHOW']]],
  'Demos Missing Customer Feedback': [['demo.demoStatus', 'IS', ['COMPLETED']], ['demo.customerFeedback', 'IS_EMPTY', true]],
  'Demos Missing RM Feedback': [['demo.demoStatus', 'IS', ['COMPLETED']], ['demo.internalRmFeedback', 'IS_EMPTY', true]],
  'Agencies with No Recent Contact': [['company.lastContacted', 'IS_EMPTY', true]],
  'Blocked Agencies': [['company.agencyStatus', 'IS', ['BLOCKED']]],
  'Qualified Leads': [['lead.stage', 'IS', ['QUALIFIED']]],
  'Leads Requiring Demo': [['lead.stage', 'IS', ['DEMO_REQUIRED']]],
  'Unassigned Active Leads': [['lead.assignedRm', 'IS_EMPTY', true], ['lead.stage', 'IS_NOT', ['WON', 'LOST', 'CONVERTED', 'BLOCKED']]],
  'Hot Leads': [['lead.fitScore', 'GREATER_THAN_OR_EQUAL', 75], ['lead.intentScore', 'GREATER_THAN_OR_EQUAL', 70]],
  'Nurture Leads': [['lead.stage', 'IS', ['NURTURE']]],
  'Demo Follow-ups Due Today': [['demo.followUpDate', 'IS_TODAY', true]],
  'High-Seriousness Completed Demos': [['demo.demoStatus', 'IS', ['COMPLETED']], ['demo.leadSeriousness', 'IS', ['HIGH']]],
  'Won Opportunities': [['opportunity.stage', 'IS', ['WON']]],
  'Lost Opportunities': [['opportunity.stage', 'IS', ['LOST']]],
  'Decision-Pending Opportunities': [['opportunity.stage', 'IS', ['DECISION_PENDING']]],
  'High-Risk Agencies': [['company.riskLevel', 'IS', ['HIGH', 'CRITICAL']]],
  'Do Not Contact Agencies': [['company.doNotContact', 'IS', true]],
};

const requiredKanbanGroups = {
  'Opportunities by Stage': ['QUALIFIED', 'DISCOVERY', 'DEMO', 'TRIAL', 'PRICING', 'NEGOTIATION', 'DECISION_PENDING', 'WON', 'LOST', 'NURTURE'],
  'Agencies by Status': ['PROSPECT', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'IN_PROGRESS', 'WIN', 'NURTURE', 'BLOCKED', 'LOSS', 'SPAM'],
};

const requiredWorkflows = {
  'New Lead → First Contact Task': {
    eventName: 'lead.created',
    objectName: 'task',
    title: 'First contact: call or WhatsApp new lead',
  },
  'Demo Scheduled → Prep & Reminder Tasks': {
    eventName: 'demo.created',
    filter: ['demoStatus', 'IS', 'SCHEDULED'],
    objectName: 'task',
    title: 'Prepare demo agenda and send reminder',
  },
  'Demo Completed → Feedback & Follow-up': {
    eventName: 'demo.updated',
    filter: ['demoStatus', 'IS', 'COMPLETED'],
    objectName: 'task',
    title: 'Capture customer and RM feedback, then follow up',
  },
  'Demo No-Show → Follow-up & Risk Review': {
    eventName: 'demo.updated',
    filter: ['demoStatus', 'IS', 'NO_SHOW'],
    objectName: 'task',
    title: 'No-show follow-up and risk review',
  },
  'Lead Qualified → Create Opportunity': {
    eventName: 'lead.updated',
    filter: ['stage', 'IS', 'QUALIFIED'],
    objectName: 'opportunity',
    stage: 'QUALIFIED',
  },
  'Active Lead Without Next Action → Create Task': {
    eventName: 'lead.updated',
    filter: ['nextAction', 'IS_EMPTY'],
    objectName: 'task',
    title: 'Set next action for active lead',
  },
};

const metadata = await gql('/metadata', `query {
  objects(paging: { first: 100 }) {
    edges { node { id nameSingular namePlural isActive isSystem } }
  }
  fields(paging: { first: 1000 }) {
    edges {
      node {
        id objectMetadataId name type options defaultValue
        relation { targetObjectMetadata { nameSingular } }
      }
    }
  }
  getRoles {
    label canUpdateAllSettings canAccessAllTools canReadAllObjectRecords
    canUpdateAllObjectRecords canSoftDeleteAllObjectRecords canDestroyAllObjectRecords
    canBeAssignedToUsers canBeAssignedToApiKeys
    permissionFlags { flag }
    objectPermissions {
      objectMetadataId canReadObjectRecords canUpdateObjectRecords
      canSoftDeleteObjectRecords canDestroyObjectRecords
    }
  }
  getViews {
    id name objectMetadataId type mainGroupByFieldMetadataId calendarFieldMetadataId
    viewFilters { fieldMetadataId operand value }
    viewGroups { fieldValue isVisible position }
  }
}`);

const workflowData = await gql('/graphql', `query {
  workflows(first: 100) {
    edges {
      node {
        name
        versions(first: 20) { edges { node { status trigger steps } } }
      }
    }
  }
}`);

const failures = [];
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const objects = new Map(metadata.objects.edges.map(({ node }) => [node.nameSingular, node]));
const fieldsByObjectId = new Map();
for (const { node } of metadata.fields.edges) {
  if (!fieldsByObjectId.has(node.objectMetadataId)) fieldsByObjectId.set(node.objectMetadataId, new Map());
  fieldsByObjectId.get(node.objectMetadataId).set(node.name, node);
}
const fieldAt = (path) => {
  const [objectName, fieldName] = path.split('.');
  const object = objects.get(objectName);
  return object ? fieldsByObjectId.get(object.id)?.get(fieldName) : undefined;
};

for (const [objectName, fieldNames] of Object.entries(requiredFields)) {
  const object = objects.get(objectName);
  if (!object || !object.isActive) {
    failures.push(`object:${objectName}`);
    continue;
  }
  for (const fieldName of fieldNames) {
    const path = `${objectName}.${fieldName}`;
    const field = fieldAt(path);
    if (!field) {
      failures.push(`field:${path}`);
      continue;
    }
    if (field.type !== requiredFieldTypes[path]) {
      failures.push(`field-type:${path}:${field.type}`);
    }
    const target = field.relation?.targetObjectMetadata?.nameSingular;
    if (requiredRelationTargets[path] && target !== requiredRelationTargets[path]) {
      failures.push(`field-relation:${path}:${target || 'missing'}`);
    }
    if (requiredOptionValues[path]) {
      const actualValues = new Set((field.options || []).map(({ value }) => value));
      if (requiredOptionValues[path].some((value) => !actualValues.has(value))) {
        failures.push(`field-options:${path}`);
      }
    }
  }
}

const requiredDefaults = {
  'company.doNotContact': false,
  'person.decisionMaker': false,
  'person.consentToContact': true,
  'demo.decisionMakerAttendance': false,
};
for (const [path, expected] of Object.entries(requiredDefaults)) {
  if (!equal(fieldAt(path)?.defaultValue, expected)) failures.push(`field-default:${path}`);
}

const roleBaseKeys = [
  'canUpdateAllSettings',
  'canAccessAllTools',
  'canReadAllObjectRecords',
  'canUpdateAllObjectRecords',
  'canSoftDeleteAllObjectRecords',
  'canDestroyAllObjectRecords',
  'canBeAssignedToUsers',
  'canBeAssignedToApiKeys',
];
const roles = new Map(metadata.getRoles.map((role) => [role.label, role]));
for (const [label, policy] of Object.entries(requiredRoles)) {
  const role = roles.get(label);
  if (!role) {
    failures.push(`role:${label}`);
    continue;
  }
  roleBaseKeys.forEach((key, index) => {
    if (role[key] !== policy.base[index]) failures.push(`role-base:${label}.${key}`);
  });
  const flags = new Set(role.permissionFlags.map(({ flag }) => flag));
  for (const flag of policy.flags) {
    if (!flags.has(flag)) failures.push(`role-flag:${label}.${flag}`);
  }
  for (const flag of policy.forbiddenFlags || []) {
    if (flags.has(flag)) failures.push(`role-forbidden-flag:${label}.${flag}`);
  }
  if (label === 'Engineer') {
    const permissions = new Map(
      role.objectPermissions.map((permission) => [permission.objectMetadataId, permission]),
    );
    for (const objectName of [...Object.keys(requiredFields), 'task']) {
      const objectId = objects.get(objectName)?.id;
      const permission = permissions.get(objectId);
      const canWrite = objectName === 'inboundSubmission' || objectName === 'task';
      if (
        !permission ||
        permission.canReadObjectRecords !== canWrite ||
        permission.canUpdateObjectRecords !== canWrite ||
        permission.canSoftDeleteObjectRecords ||
        permission.canDestroyObjectRecords
      ) {
        failures.push(`role-object-permission:Engineer.${objectName}`);
      }
    }
  }
}

const viewsByName = new Map();
for (const view of metadata.getViews) {
  if (!viewsByName.has(view.name)) viewsByName.set(view.name, []);
  viewsByName.get(view.name).push(view);
}
for (const [objectName, viewNames] of Object.entries(requiredViewModels)) {
  for (const viewName of viewNames) {
    const matches = viewsByName.get(viewName) || [];
    if (matches.length !== 1) {
      failures.push(`view:${viewName}:${matches.length}`);
      continue;
    }
    const view = matches[0];
    const expectedType = requiredViewTypes[viewName] || 'TABLE';
    if (view.objectMetadataId !== objects.get(objectName)?.id) failures.push(`view-object:${viewName}`);
    if (view.type !== expectedType) failures.push(`view-type:${viewName}:${view.type}`);
    for (const [fieldPath, operand, value] of requiredViewFilters[viewName] || []) {
      const fieldId = fieldAt(fieldPath)?.id;
      const found = view.viewFilters.some(
        (filter) =>
          filter.fieldMetadataId === fieldId &&
          filter.operand === operand &&
          equal(filter.value, value),
      );
      if (!found) failures.push(`view-filter:${viewName}:${fieldPath}:${operand}`);
    }
    const expectedFilterCount = (requiredViewFilters[viewName] || []).length;
    if (view.viewFilters.length !== expectedFilterCount) {
      failures.push(`view-filter-count:${viewName}:${view.viewFilters.length}`);
    }
    const requiredGroupValues = requiredKanbanGroups[viewName];
    if (requiredGroupValues) {
      const expectedGroupField =
        viewName === 'Agencies by Status'
          ? fieldAt('company.agencyStatus')
          : fieldAt('opportunity.stage');
      if (view.mainGroupByFieldMetadataId !== expectedGroupField?.id) {
        failures.push(`view-group-field:${viewName}`);
      }
      const groupValues = (expectedGroupField?.options || []).map(({ value }) => value);
      const visibleGroupValues = view.viewGroups
        .filter(({ isVisible }) => isVisible)
        .map(({ fieldValue }) => fieldValue);
      const visibleGroups = new Set(visibleGroupValues);
      if (
        view.viewGroups.length !== groupValues.length ||
        visibleGroupValues.length !== groupValues.length ||
        visibleGroups.size !== groupValues.length
      ) {
        failures.push(`view-group-count:${viewName}:${view.viewGroups.length}`);
      }
      for (const value of groupValues) {
        if (!visibleGroups.has(value)) failures.push(`view-group:${viewName}:${value}`);
      }
    }
    if (
      viewName === 'Demo Calendar' &&
      view.calendarFieldMetadataId !== fieldAt('demo.scheduledDate')?.id
    ) {
      failures.push(`view-calendar-field:${viewName}`);
    }
  }
}

const workflowsByName = new Map();
for (const { node } of workflowData.workflows.edges) {
  if (!workflowsByName.has(node.name)) workflowsByName.set(node.name, []);
  workflowsByName.get(node.name).push(node);
}
for (const [workflowName, spec] of Object.entries(requiredWorkflows)) {
  const matches = workflowsByName.get(workflowName) || [];
  if (matches.length !== 1) {
    failures.push(`workflow:${workflowName}:${matches.length}`);
    continue;
  }
  const versions = matches[0].versions.edges.map(({ node }) => node);
  const drafts = versions.filter(({ status }) => status === 'DRAFT');
  if (versions.some(({ status }) => status === 'ACTIVE')) failures.push(`workflow-active:${workflowName}`);
  if (drafts.length !== 1) failures.push(`workflow-draft-count:${workflowName}:${drafts.length}`);
  const draft = drafts[0];
  if (!draft || !draft.trigger || draft.steps?.length !== 1) {
    failures.push(`workflow-config:${workflowName}`);
    continue;
  }
  if (draft.trigger.type !== 'DATABASE_EVENT' || draft.trigger.settings?.eventName !== spec.eventName) {
    failures.push(`workflow-trigger:${workflowName}`);
  }
  const step = draft.steps[0];
  if (!draft.trigger.nextStepIds?.includes(step.id)) failures.push(`workflow-link:${workflowName}`);
  if (step.type !== 'CREATE_RECORD' || step.settings?.input?.objectName !== spec.objectName) {
    failures.push(`workflow-step:${workflowName}`);
  }
  const record = step.settings?.input?.objectRecord || {};
  if (spec.title && record.title !== spec.title) failures.push(`workflow-title:${workflowName}`);
  if (spec.stage && record.stage !== spec.stage) failures.push(`workflow-stage:${workflowName}`);
  const actualFilters = draft.trigger.settings?.filter?.stepFilters || [];
  if (spec.filter) {
    const [fieldName, operand, value] = spec.filter;
    const matched = actualFilters.some((filter) => {
      let parsed;
      try {
        parsed = JSON.parse(filter.value);
      } catch {
        parsed = filter.value;
      }
      const valueMatches = operand === 'IS_EMPTY' || (Array.isArray(parsed) && parsed.includes(value));
      return (
        filter.stepOutputKey === `{{trigger.properties.after.${fieldName}}}` &&
        filter.operand === operand &&
        valueMatches
      );
    });
    if (!matched) failures.push(`workflow-filter:${workflowName}`);
  } else if (actualFilters.length > 0) {
    failures.push(`workflow-unexpected-filter:${workflowName}`);
  }
}


const setupReport = JSON.parse(
  fs.readFileSync(new URL('./setup-report.json', import.meta.url), 'utf8'),
);
const countedObjects = [...objects.values()].filter(
  (object) =>
    object.isActive &&
    !object.isSystem &&
    !['workflow', 'dashboard'].includes(object.nameSingular),
);
const recordCountsAfter = await gql(
  '/graphql',
  `query {
    ${countedObjects
      .map((object) => `${object.namePlural}: ${object.namePlural}(first: 1) { totalCount }`)
      .join('\n')}
  }`,
);
for (const [name, expectedCount] of Object.entries(setupReport.recordCountsBefore || {})) {
  const actualCount = recordCountsAfter[name]?.totalCount;
  if (actualCount !== expectedCount) {
    failures.push(`record-count:${name}:${expectedCount}->${actualCount ?? 'missing'}`);
  }
}
const result = {
  ok: failures.length === 0,
  target: BASE,
  checked: {
    objects: Object.keys(requiredFields).length,
    fields: Object.values(requiredFields).reduce((total, fields) => total + fields.length, 0),
    roles: Object.keys(requiredRoles).length,
    views: requiredViews.length,
    workflows: Object.keys(requiredWorkflows).length,
  },
  failures,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

import { Api, Row } from './types'
import { Rng, pastMs, iso, WORLD_NOW } from '../gen/prng'
import { company, later, person, resetUnique, sentences } from '../gen/helpers'
import { AGENT_LINES, TAG_WORDS, TICKET_LINES, TICKET_SUBJECTS } from '../gen/words'

export const helpdeskApi: Api = {
  name: 'helpdesk',
  title: 'Helpdesk',
  tagline: 'A support desk: tickets, messages, agents, customers, SLAs — the state-machine one.',
  doc: 'Two thousand tickets with their message threads, twenty-five agents in four teams and three hundred customer companies. A ticket moves open → pending → resolved → closed; PATCH its status and the hub checks the transition and stamps the timestamps.',
  collections: [
    {
      name: 'teams',
      singular: 'team',
      doc: 'Support teams.',
      count: 4,
      fields: [
        { name: 'name', type: 'string', required: true, example: 'Tier 1' },
        { name: 'slug', type: 'string' },
        { name: 'timezone', type: 'string' },
        { name: 'hours', type: 'string', example: '24/7' },
      ],
      relations: [{ name: 'agents', kind: 'hasMany', collection: 'agents', field: 'team_id' }],
    },
    {
      name: 'agents',
      singular: 'agent',
      doc: 'The people answering tickets.',
      count: 25,
      preview: ['id', 'name', 'email', 'team_id', 'role', 'status', 'open_tickets'],
      fields: [
        { name: 'name', type: 'string', required: true },
        { name: 'email', type: 'string', required: true },
        { name: 'team_id', type: 'ref', ref: 'teams', required: true },
        { name: 'role', type: 'enum', values: ['agent', 'senior', 'lead', 'admin'] },
        { name: 'status', type: 'enum', values: ['available', 'busy', 'away', 'offline'] },
        { name: 'skills', type: 'json', shape: 'string[]' },
        { name: 'open_tickets', type: 'int', readonly: true },
        { name: 'rating', type: 'float', readonly: true },
      ],
      relations: [
        { name: 'team', kind: 'belongsTo', collection: 'teams', field: 'team_id' },
        { name: 'tickets', kind: 'hasMany', collection: 'tickets', field: 'assignee_id' },
      ],
    },
    {
      name: 'customers',
      singular: 'customer',
      doc: 'Companies with a support contract.',
      count: 300,
      preview: ['id', 'name', 'plan', 'contact_name', 'contact_email', 'open_tickets'],
      fields: [
        { name: 'name', type: 'string', required: true, example: 'Blue Systems Inc.' },
        { name: 'domain', type: 'string', example: 'bluesystems.example' },
        { name: 'plan', type: 'enum', values: ['free', 'starter', 'business', 'enterprise'] },
        { name: 'contact_name', type: 'string' },
        { name: 'contact_email', type: 'string' },
        { name: 'sla_hours', type: 'int', doc: 'First response target, hours.' },
        { name: 'open_tickets', type: 'int', readonly: true },
        { name: 'satisfaction', type: 'float', readonly: true, doc: 'Average CSAT, 1–5.' },
      ],
      relations: [{ name: 'tickets', kind: 'hasMany', collection: 'tickets', field: 'customer_id' }],
    },
    {
      name: 'tickets',
      singular: 'ticket',
      doc: 'A support request. Allowed status moves: open → pending | resolved; pending → open | resolved; resolved → closed | open; closed → open (reopen). Anything else answers 422.',
      count: 2000,
      sort: '-created_at',
      preview: ['id', 'number', 'subject', 'status', 'priority', 'customer_id', 'assignee_id', 'created_at'],
      fields: [
        { name: 'number', type: 'string', readonly: true, example: 'HD-10042' },
        { name: 'subject', type: 'string', required: true },
        { name: 'description', type: 'text' },
        { name: 'status', type: 'enum', values: ['open', 'pending', 'resolved', 'closed'] },
        { name: 'priority', type: 'enum', values: ['low', 'normal', 'high', 'urgent'] },
        { name: 'category', type: 'enum', values: ['billing', 'account', 'bug', 'feature', 'howto'] },
        { name: 'channel', type: 'enum', values: ['email', 'chat', 'phone', 'web', 'api'] },
        { name: 'customer_id', type: 'ref', ref: 'customers', required: true },
        { name: 'requester_email', type: 'string' },
        { name: 'assignee_id', type: 'ref', ref: 'agents' },
        { name: 'team_id', type: 'ref', ref: 'teams' },
        { name: 'tags', type: 'json', shape: 'string[]' },
        { name: 'first_response_at', type: 'datetime', readonly: true },
        { name: 'resolved_at', type: 'datetime', readonly: true },
        { name: 'closed_at', type: 'datetime', readonly: true },
        { name: 'due_at', type: 'datetime' },
        { name: 'sla_breached', type: 'bool', readonly: true },
        { name: 'satisfaction', type: 'int', min: 1, max: 5, doc: 'CSAT given at close.' },
        { name: 'message_count', type: 'int', readonly: true },
      ],
      relations: [
        { name: 'customer', kind: 'belongsTo', collection: 'customers', field: 'customer_id' },
        { name: 'assignee', kind: 'belongsTo', collection: 'agents', field: 'assignee_id' },
        { name: 'team', kind: 'belongsTo', collection: 'teams', field: 'team_id' },
        { name: 'messages', kind: 'hasMany', collection: 'messages', field: 'ticket_id' },
      ],
    },
    {
      name: 'messages',
      singular: 'message',
      doc: 'The thread on a ticket, in order. author_type says who wrote it.',
      count: 6000,
      sort: 'id',
      preview: ['id', 'ticket_id', 'author_type', 'body', 'created_at'],
      fields: [
        { name: 'ticket_id', type: 'ref', ref: 'tickets', required: true },
        { name: 'author_type', type: 'enum', required: true, values: ['customer', 'agent', 'system'] },
        { name: 'author_id', type: 'ref', ref: 'agents', doc: 'The agent, when author_type is agent.' },
        { name: 'author_name', type: 'string' },
        { name: 'body', type: 'text', required: true },
        { name: 'internal', type: 'bool', doc: 'A private note the customer does not see.' },
        { name: 'attachments', type: 'json', shape: '{ name, size, content_type }[]' },
      ],
      relations: [
        { name: 'ticket', kind: 'belongsTo', collection: 'tickets', field: 'ticket_id' },
        { name: 'author', kind: 'belongsTo', collection: 'agents', field: 'author_id' },
      ],
    },
  ],
  feeds: [
    { topic: 'tickets', doc: 'A ticket opening, being assigned, or changing status.', every: '5 s' },
    { topic: 'messages', doc: 'A new message on a ticket.', every: '4 s' },
  ],
}

export const TICKET_TRANSITIONS: Record<string, string[]> = {
  open: ['pending', 'resolved'],
  pending: ['open', 'resolved'],
  resolved: ['closed', 'open'],
  closed: ['open'],
}

export function generateHelpdesk(): Record<string, Row[]> {
  resetUnique()
  const r = new Rng('helpdesk')
  const base = WORLD_NOW - 800 * 86400000
  const teams: Row[] = [
    { id: 1, name: 'Tier 1', slug: 'tier-1', timezone: 'America/New_York', hours: '24/7' },
    { id: 2, name: 'Tier 2', slug: 'tier-2', timezone: 'America/New_York', hours: 'Mon–Fri 08:00–20:00' },
    { id: 3, name: 'Billing', slug: 'billing', timezone: 'Europe/Dublin', hours: 'Mon–Fri 09:00–18:00' },
    { id: 4, name: 'Enterprise', slug: 'enterprise', timezone: 'America/Los_Angeles', hours: '24/7' },
  ].map((t) => ({ ...t, created_at: iso(base), updated_at: iso(base) }))

  const agents: Row[] = []
  for (let i = 1; i <= 25; i++) {
    const p = person(r)
    const teamId = i <= 10 ? 1 : i <= 17 ? 2 : i <= 21 ? 3 : 4
    const created = pastMs(r, 700, 30)
    agents.push({
      id: i,
      name: p.name,
      email: `${p.username}@support.example`,
      team_id: teamId,
      role: i === 1 ? 'admin' : r.weighted([['agent', 70], ['senior', 20], ['lead', 10]] as const),
      status: r.weighted([['available', 50], ['busy', 25], ['away', 10], ['offline', 15]] as const),
      skills: JSON.stringify(r.some(['billing', 'api', 'mobile', 'sso', 'integrations', 'onboarding', 'security', 'reports'], r.int(1, 3))),
      open_tickets: 0,
      rating: r.float(3.6, 5, 1),
      created_at: iso(created),
      updated_at: iso(created),
    })
  }

  const customers: Row[] = []
  for (let i = 1; i <= 300; i++) {
    const name = company(r)
    const contact = person(r)
    const created = pastMs(r, 900, 10)
    const plan = r.weighted([['free', 30], ['starter', 35], ['business', 25], ['enterprise', 10]] as const)
    customers.push({
      id: i,
      name,
      domain: `${name.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 14)}.example`,
      plan,
      contact_name: contact.name,
      contact_email: `${contact.username}@${name.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 14)}.example`,
      sla_hours: plan === 'enterprise' ? 1 : plan === 'business' ? 4 : plan === 'starter' ? 24 : 72,
      open_tickets: 0,
      satisfaction: null,
      created_at: iso(created),
      updated_at: iso(created),
    })
  }

  const tickets: Row[] = []
  const messages: Row[] = []
  let mid = 1
  const csat = new Map<number, { n: number; s: number }>()
  for (let i = 1; i <= 2000; i++) {
    const customer = customers[r.int(0, customers.length - 1)]
    const category = r.weighted([['billing', 20], ['account', 22], ['bug', 28], ['feature', 12], ['howto', 18]] as const)
    const created = pastMs(r, 180, 0)
    const ageH = (WORLD_NOW - created) / 3600000
    const status = ageH < 4 ? r.weighted([['open', 80], ['pending', 20]] as const) : ageH < 72 ? r.weighted([['open', 25], ['pending', 30], ['resolved', 35], ['closed', 10]] as const) : r.weighted([['closed', 70], ['resolved', 18], ['pending', 7], ['open', 5]] as const)
    const priority = customer.plan === 'enterprise' ? r.weighted([['normal', 40], ['high', 40], ['urgent', 20]] as const) : r.weighted([['low', 20], ['normal', 55], ['high', 20], ['urgent', 5]] as const)
    const teamId = category === 'billing' ? 3 : customer.plan === 'enterprise' ? 4 : r.weighted([[1, 70], [2, 30]] as const)
    const teamAgents = agents.filter((a) => a.team_id === teamId)
    const assignee = status === 'open' && r.chance(0.3) ? null : r.pick(teamAgents)
    const slaHours = customer.sla_hours as number
    const first = assignee ? later(created, r, 5, slaHours * 60 * 1.6) : null
    const resolved = status === 'resolved' || status === 'closed' ? later(first ?? created, r, 30, 60 * 24 * 5) : null
    const closed = status === 'closed' ? later(resolved!, r, 60, 60 * 24 * 3) : null
    const sat = closed && r.chance(0.6) ? r.weighted([[5, 45], [4, 30], [3, 12], [2, 7], [1, 6]] as const) : null
    const contact = customer.contact_email as string
    tickets.push({
      id: i,
      number: `HD-${10000 + i}`,
      subject: r.pick(TICKET_SUBJECTS[category]),
      description: sentences(r, TICKET_LINES, r.int(1, 3)),
      status,
      priority,
      category,
      channel: r.weighted([['email', 45], ['web', 25], ['chat', 18], ['phone', 8], ['api', 4]] as const),
      customer_id: customer.id,
      requester_email: contact,
      assignee_id: assignee ? assignee.id : null,
      team_id: teamId,
      tags: JSON.stringify(r.some(TAG_WORDS, r.weighted([[0, 45], [1, 35], [2, 20]] as const))),
      first_response_at: first ? iso(Math.min(first, WORLD_NOW)) : null,
      resolved_at: resolved ? iso(Math.min(resolved, WORLD_NOW)) : null,
      closed_at: closed ? iso(Math.min(closed, WORLD_NOW)) : null,
      due_at: iso(created + slaHours * 3600000),
      sla_breached: first ? (first - created > slaHours * 3600000 ? 1 : 0) : ageH > slaHours ? 1 : 0,
      satisfaction: sat,
      message_count: 0,
      created_at: iso(created),
      updated_at: iso(Math.min(closed ?? resolved ?? first ?? created, WORLD_NOW)),
    })
    if (status === 'open' || status === 'pending') {
      ;(customer.open_tickets as number)++
      if (assignee) (assignee.open_tickets as number)++
    }
    if (sat) {
      const s = csat.get(customer.id as number) ?? { n: 0, s: 0 }
      s.n++
      s.s += sat
      csat.set(customer.id as number, s)
    }
    // thread
    const nMsgs = Math.min(r.weighted([[1, 30], [2, 25], [3, 20], [4, 13], [5, 7], [6, 5]] as const), 6)
    let at = created
    for (let k = 0; k < nMsgs && mid <= 6000; k++) {
      const fromAgent = k > 0 && assignee && (k % 2 === 1 || r.chance(0.3))
      messages.push({
        id: mid++,
        ticket_id: i,
        author_type: fromAgent ? 'agent' : k === 0 ? 'customer' : r.chance(0.1) ? 'system' : 'customer',
        author_id: fromAgent ? assignee!.id : null,
        author_name: fromAgent ? (assignee!.name as string) : k === 0 || !r.chance(0.1) ? (customer.contact_name as string) : 'System',
        body: fromAgent ? r.pick(AGENT_LINES) : k === 0 ? sentences(r, TICKET_LINES, r.int(1, 2)) : r.pick(TICKET_LINES),
        internal: fromAgent && r.chance(0.15) ? 1 : 0,
        attachments: r.chance(0.12) ? JSON.stringify([{ name: r.pick(['screenshot.png', 'invoice.pdf', 'log.txt', 'export.csv']), size: r.int(2000, 900000), content_type: r.pick(['image/png', 'application/pdf', 'text/plain', 'text/csv']) }]) : JSON.stringify([]),
        created_at: iso(Math.min(at, WORLD_NOW)),
        updated_at: iso(Math.min(at, WORLD_NOW)),
      })
      ;(tickets[i - 1].message_count as number)++
      at = later(at, r, 10, 60 * 20)
    }
  }
  for (const c of customers) {
    const s = csat.get(c.id as number)
    c.satisfaction = s ? Math.round((s.s / s.n) * 10) / 10 : null
  }

  return { teams, agents, customers, tickets, messages }
}

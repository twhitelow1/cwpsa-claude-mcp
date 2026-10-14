import { z } from "zod";
import { cw } from "../cw/client";
import { and, cond, or } from "../cw/conditions";
import { compact, ref } from "../sanitize";
import { id, limit, searchText } from "./common";
import { defineTool } from "./types";

type Raw = Record<string, any>;

function mapCompany(c: Raw) {
  return compact({
    id: c.id,
    identifier: c.identifier,
    name: c.name,
    status: c.status?.name,
    types: Array.isArray(c.types) ? c.types.map((t: Raw) => t.name).join(", ") : undefined,
    phone: c.phoneNumber,
    website: c.website,
    city: c.city,
    state: c.state,
    territory: c.territory?.name,
  });
}

export const searchCompanies = defineTool({
  name: "cw_search_companies",
  title: "Search companies",
  description:
    "Find ConnectWise companies (clients/vendors) by partial name, identifier, status or type. Returns id, identifier " +
    "and basics. Use the id with other tools (company_id).",
  input: z.object({
    name: searchText.optional().describe("Partial company name"),
    identifier: searchText.optional().describe("Exact company identifier"),
    status: searchText.optional().describe("Status name, e.g. 'Active'"),
    type: searchText.optional().describe("Company type name, e.g. 'Client', 'Vendor'"),
    limit: limit(25, 500),
  }),
  write: false,
  async handler(i) {
    const conditions = and(
      cond.eq("deletedFlag", false),
      i.name && cond.contains("name", i.name),
      i.identifier && cond.eq("identifier", i.identifier),
      i.status && cond.eq("status/name", i.status),
    );
    const childConditions = i.type ? cond.eq("types/name", i.type) : undefined;
    const r = await cw().list<Raw>("/company/companies", { conditions, childConditions, orderBy: "name asc" }, i.limit);
    return { count: r.items.length, truncated: r.truncated, companies: r.items.map(mapCompany) };
  },
});

export const getCompany = defineTool({
  name: "cw_get_company",
  title: "Get company",
  description: "Get one ConnectWise company by id with address, default contact, site and account details.",
  input: z.object({ company_id: id }),
  write: false,
  auditIds: (i) => ({ company_id: i.company_id }),
  async handler(i) {
    const c = await cw().get<Raw>(`/company/companies/${i.company_id}`);
    return compact({
      ...mapCompany(c),
      address: [c.addressLine1, c.addressLine2, c.city, c.state, c.zip, c.country?.name].filter(Boolean).join(", "),
      defaultContact: ref(c.defaultContact),
      site: ref(c.site),
      market: c.market?.name,
      accountNumber: c.accountNumber,
      dateAcquired: c.dateAcquired,
      annualRevenue: c.annualRevenue,
      numberOfEmployees: c.numberOfEmployees,
    });
  },
});

function mapContact(c: Raw) {
  const comms: Raw[] = Array.isArray(c.communicationItems) ? c.communicationItems : [];
  const email = comms.find((x) => x.communicationType === "Email" && x.defaultFlag) ?? comms.find((x) => x.communicationType === "Email");
  const phone = comms.find((x) => x.communicationType === "Phone" && x.defaultFlag) ?? comms.find((x) => x.communicationType === "Phone");
  return compact({
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(" "),
    title: c.title,
    company: ref(c.company),
    email: email?.value,
    phone: phone?.value ?? c.defaultPhoneNbr,
    inactive: c.inactiveFlag || undefined,
  });
}

export const searchContacts = defineTool({
  name: "cw_search_contacts",
  title: "Search contacts",
  description: "Find ConnectWise contacts by name (first, last or 'first last'), company, or email fragment.",
  input: z.object({
    name: searchText.optional(),
    company_id: id.optional(),
    email: searchText.optional().describe("Partial email address"),
    include_inactive: z.boolean().default(false),
    limit: limit(25, 500),
  }),
  write: false,
  auditIds: (i) => ({ company_id: i.company_id }),
  async handler(i) {
    let nameCond: string | undefined;
    if (i.name) {
      const parts = i.name.split(/\s+/);
      nameCond =
        parts.length > 1
          ? and(cond.contains("firstName", parts[0]), cond.contains("lastName", parts.slice(1).join(" ")))
          : or(cond.contains("firstName", i.name), cond.contains("lastName", i.name));
    }
    const conditions = and(!i.include_inactive && cond.eq("inactiveFlag", false), nameCond, i.company_id && cond.eq("company/id", i.company_id));
    const childConditions = i.email ? cond.contains("communicationItems/value", i.email) : undefined;
    const r = await cw().list<Raw>("/company/contacts", { conditions, childConditions, orderBy: "lastName asc" }, i.limit);
    return { count: r.items.length, truncated: r.truncated, contacts: r.items.map(mapContact) };
  },
});

export const searchConfigurations = defineTool({
  name: "cw_search_configurations",
  title: "Search configurations",
  description:
    "Find ConnectWise configurations (devices/assets) by company, partial name, type, serial number or status. Active only by default.",
  input: z.object({
    company_id: id.optional(),
    name: searchText.optional(),
    type: searchText.optional().describe("Configuration type name, partial"),
    serial: searchText.optional(),
    status: searchText.optional().describe("Status name, exact"),
    include_inactive: z.boolean().default(false),
    limit: limit(50, 1000),
  }),
  write: false,
  auditIds: (i) => ({ company_id: i.company_id }),
  async handler(i) {
    const conditions = and(
      !i.include_inactive && cond.eq("activeFlag", true),
      i.company_id && cond.eq("company/id", i.company_id),
      i.name && cond.contains("name", i.name),
      i.type && cond.contains("type/name", i.type),
      i.serial && cond.contains("serialNumber", i.serial),
      i.status && cond.eq("status/name", i.status),
    );
    const r = await cw().list<Raw>("/company/configurations", { conditions, orderBy: "name asc" }, i.limit);
    return {
      count: r.items.length,
      truncated: r.truncated,
      configurations: r.items.map((c) =>
        compact({
          id: c.id,
          name: c.name,
          type: c.type?.name,
          status: c.status?.name,
          company: ref(c.company),
          contact: ref(c.contact),
          serial: c.serialNumber,
          model: c.modelNumber,
          tag: c.tagNumber,
          ip: c.ipAddress,
          os: c.osType,
          lastLogin: c.lastLoginName,
          warrantyExpires: c.warrantyExpirationDate,
        }),
      ),
    };
  },
});

export const getAgreements = defineTool({
  name: "cw_get_agreements",
  title: "Get agreements",
  description:
    "List ConnectWise agreements (managed services / block time contracts), usually for one company. Active (not " +
    "cancelled, not expired) by default. Shows type, dates, billing amount and application limits.",
  input: z.object({
    company_id: id.optional(),
    include_inactive: z.boolean().default(false),
    limit: limit(50, 500),
  }),
  write: false,
  auditIds: (i) => ({ company_id: i.company_id }),
  async handler(i) {
    const conditions = and(!i.include_inactive && cond.eq("cancelledFlag", false), i.company_id && cond.eq("company/id", i.company_id));
    const r = await cw().list<Raw>("/finance/agreements", { conditions, orderBy: "name asc" }, i.limit);
    const now = Date.now();
    const rows = r.items
      .filter((a) => i.include_inactive || a.noEndingDateFlag || !a.endDate || Date.parse(a.endDate) >= now)
      .map((a) =>
        compact({
          id: a.id,
          name: a.name,
          type: a.type?.name,
          company: ref(a.company),
          status: a.agreementStatus,
          start: a.startDate,
          end: a.noEndingDateFlag ? "no end date" : a.endDate,
          billAmount: a.billAmount,
          billingCycle: a.billingCycle?.name,
          applicationUnits: a.applicationUnits,
          applicationLimit: a.applicationLimit,
          cancelled: a.cancelledFlag || undefined,
        }),
      );
    return { count: rows.length, truncated: r.truncated, agreements: rows };
  },
});

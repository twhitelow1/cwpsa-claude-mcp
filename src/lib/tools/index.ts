import { getCompany, getAgreements, searchCompanies, searchConfigurations, searchContacts } from "./companies";
import { priceCatalog, searchCatalog } from "./catalog";
import { listBoardsStatuses, listMembers } from "./system";
import { getTicket, listTicketNotes, searchTickets } from "./tickets";
import { searchTimeEntries, timeSummary } from "./time";
import type { ToolDef } from "./types";
import { addSalesOrderLine, addTicketNote, addTimeEntry, createOpportunity, createSalesOrder, updateTicket } from "./write-tools";

export const readTools = [
  searchTickets,
  getTicket,
  listTicketNotes,
  searchTimeEntries,
  timeSummary,
  searchCompanies,
  getCompany,
  searchContacts,
  searchConfigurations,
  getAgreements,
  searchCatalog,
  priceCatalog,
  listMembers,
  listBoardsStatuses,
] as unknown as ToolDef[];

export const writeTools = [addTicketNote, addTimeEntry, updateTicket, createOpportunity, createSalesOrder, addSalesOrderLine] as unknown as ToolDef[];

export const allTools: ToolDef[] = [...readTools, ...writeTools];

export const toolByName = new Map(allTools.map((t) => [t.name, t]));

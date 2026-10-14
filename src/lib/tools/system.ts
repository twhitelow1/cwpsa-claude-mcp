import { z } from "zod";
import { cw } from "../cw/client";
import { and, cond, or } from "../cw/conditions";
import { compact } from "../sanitize";
import { id, limit, searchText } from "./common";
import { defineTool } from "./types";

type Raw = Record<string, any>;

export const listMembers = defineTool({
  name: "cw_list_members",
  title: "List members",
  description:
    "List ConnectWise members (staff users) with id and identifier. Use to find the member identifier for ticket " +
    "assignment and time entry filters/writes.",
  input: z.object({
    name: searchText.optional().describe("Partial first/last name or identifier"),
    include_inactive: z.boolean().default(false),
    limit: limit(200, 1000),
  }),
  write: false,
  async handler(i) {
    const conditions = and(
      !i.include_inactive && cond.eq("inactiveFlag", false),
      i.name && or(cond.contains("identifier", i.name), cond.contains("firstName", i.name), cond.contains("lastName", i.name)),
    );
    const r = await cw().list<Raw>("/system/members", { conditions, orderBy: "identifier asc" }, i.limit);
    return {
      count: r.items.length,
      members: r.items.map((m) =>
        compact({
          id: m.id,
          identifier: m.identifier,
          name: [m.firstName, m.lastName].filter(Boolean).join(" "),
          title: m.title,
          email: m.officeEmail,
          inactive: m.inactiveFlag || undefined,
        }),
      ),
    };
  },
});

export const listBoardsStatuses = defineTool({
  name: "cw_list_boards_statuses",
  title: "List boards, statuses, priorities",
  description:
    "List service boards with their statuses (id, name, closed?) plus ticket priorities, so you can pick valid ids " +
    "for ticket searches and cw_update_ticket. Pass board_id to get statuses for one board only.",
  input: z.object({ board_id: id.optional(), include_inactive: z.boolean().default(false) }),
  write: false,
  auditIds: (i) => ({ board_id: i.board_id }),
  async handler(i) {
    const client = cw();
    const [boards, priorities] = await Promise.all([
      client.list<Raw>(
        "/service/boards",
        { conditions: and(!i.include_inactive && cond.eq("inactiveFlag", false), i.board_id && cond.eq("id", i.board_id)), orderBy: "name asc" },
        200,
      ),
      client.list<Raw>("/service/priorities", { orderBy: "sortOrder asc" }, 100),
    ]);
    const selected = boards.items.slice(0, 40);
    const statuses = await Promise.all(
      selected.map((b) =>
        client.list<Raw>(
          `/service/boards/${b.id}/statuses`,
          { conditions: i.include_inactive ? undefined : cond.eq("inactive", false), orderBy: "sortOrder asc" },
          200,
        ),
      ),
    );
    return {
      boards: selected.map((b, idx) => ({
        id: b.id,
        name: b.name,
        statuses: statuses[idx].items.map((s) => compact({ id: s.id, name: s.name, closed: s.closedStatus || undefined, default: s.defaultFlag || undefined })),
      })),
      boardsTruncated: boards.items.length > selected.length || undefined,
      priorities: priorities.items.map((p) => ({ id: p.id, name: p.name })),
    };
  },
});


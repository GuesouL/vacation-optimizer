import { describe, expect, it } from "vitest";

import { personLine } from "./people";

const person = (over: Partial<Parameters<typeof personLine>[0]>) => ({
  id: 1, name: "Pat", kind: "ADULT" as const, mine: true, pto_balance: 10, work_week: [0, 1, 2, 3, 4], pto_left: 9, ...over,
});

describe("personLine", () => {
  it("says who they are and their PTO", () => {
    expect(personLine(person({}), 1)).toBe("You · 9 of 10 PTO days left");
    expect(personLine(person({ id: 2 }), 1)).toBe("Adult you manage · 9 of 10 PTO days left");
    expect(personLine(person({ id: 3, mine: false, pto_balance: null, pto_left: 1 }), 1)).toBe("Joined from an invite · 1 PTO day left");
  });

  it("leaves PTO out for kids and unknown balances", () => {
    expect(personLine(person({ id: 4, kind: "CHILD", pto_balance: null, pto_left: null }), 1)).toBe("Kid");
    expect(personLine(person({ id: 5, mine: false, pto_left: null }), 1)).toBe("Joined from an invite");
  });
});

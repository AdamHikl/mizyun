import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Icon: "Icon" }));
vi.mock("@/constants/theme", () => ({
  MinTouchTarget: 44,
  Radius: { sm: 8, md: 12, pill: 999 },
  Spacing: { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32 },
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ primary: "#0A8F63", primaryLight: "#DDF3EA" }),
}));
// The swatch lives in the sheet module, which pulls in native photo modules.
vi.mock("./log-boulder-sheet", () => ({
  HoldColourSwatch: "HoldColourSwatch",
}));

import { GradePyramid } from "./grade-pyramid";
import { HardestSendTimeline } from "./hardest-send-timeline";
import { ProjectsList } from "./projects-list";
import {
  progressFixture,
  projectFixture,
} from "./progress-fixtures.test-support";

function findAll(node: any, predicate: (node: any) => boolean): any[] {
  if (Array.isArray(node)) return node.flatMap((c) => findAll(c, predicate));
  if (!node || typeof node !== "object") return [];
  const here = predicate(node) ? [node] : [];
  if (typeof node.type === "function")
    return [...here, ...findAll(node.type(node.props), predicate)];
  return [...here, ...findAll(node.props?.children, predicate)];
}
const texts = (node: any): string[] =>
  findAll(node, (n) => n.type === "ThemedText").map((n) =>
    [n.props.children].flat().join(""),
  );
const labelled = (node: any) =>
  findAll(node, (n) => n.props?.accessible === true).map(
    (n) => n.props.accessibilityLabel,
  );

describe("GradePyramid", () => {
  it("renders hardest first with a count on every bar and row labels", () => {
    const tree = GradePyramid({ pyramid: progressFixture().pyramid });
    expect(labelled(tree)).toEqual([
      "6C plus: 1 send, 0 flashes",
      "6B: 7 sends, 3 flashes",
      "6A: 10 sends, 4 flashes",
    ]);
    const shown = texts(tree);
    expect(shown).toEqual(
      expect.arrayContaining(["1", "7 · 3 flash", "10 · 4 flash"]),
    );
    expect(shown.indexOf("6C+")).toBeLessThan(shown.indexOf("6A"));
  });

  it("shows flashes as a striped pattern with a text legend, not colour alone", () => {
    const tree = GradePyramid({ pyramid: progressFixture().pyramid });
    expect(texts(tree)).toEqual(
      expect.arrayContaining(["Sent", "Flash (striped)"]),
    );
    const hatches = findAll(tree, (n) => n.props?.testID === "flash-hatch");
    // Legend swatch + 6B + 6A (6C+ has no flashes).
    expect(hatches).toHaveLength(3);
    expect(hatches[1].props.children.length).toBeGreaterThan(1);
  });

  it("renders nothing without sends", () => {
    expect(GradePyramid({ pyramid: [] })).toBeNull();
  });
});

describe("HardestSendTimeline", () => {
  it("marks PB sessions with an icon and text and says No sends", () => {
    const tree = HardestSendTimeline({ timeline: progressFixture().timeline });
    const shown = texts(tree);
    expect(shown).toContain("No sends");
    expect(shown.filter((t) => t === "PB")).toHaveLength(1);
    expect(
      findAll(tree, (n) => n.type === "Icon" && n.props.name === "starFill"),
    ).toHaveLength(1);
    const labels = labelled(tree);
    expect(labels).toHaveLength(3);
    expect(labels[1]).toMatch(/: No sends$/);
    expect(labels[2]).toMatch(/hardest send 6C plus, personal best$/);
    expect(shown[0]).toMatch(/^Hardest send in each of the last 3 sessions\./);
  });
});

describe("ProjectsList", () => {
  const open = projectFixture({ id: "99999999-9999-4999-8999-000000000001" });
  const older = projectFixture({
    id: "99999999-9999-4999-8999-000000000002",
    grade: "6C",
    holdColour: null,
    older: true,
  });
  const sent = projectFixture({
    id: "99999999-9999-4999-8999-000000000003",
    status: "sent",
    sentAt: "2026-10-12T10:00:00.000Z",
    sentAscentId: "99999999-9999-4999-8999-000000000030",
    sentAfterSessions: 4,
  });
  const archived = projectFixture({
    id: "99999999-9999-4999-8999-000000000004",
    grade: "7A",
    status: "archived",
  });
  const props = (over = {}) => ({
    projects: [open, older, sent, archived],
    archivedOpen: false,
    onToggleArchived: vi.fn(),
    onArchive: vi.fn(),
    ...over,
  });

  it("groups older projects and shows Sent after N sessions; archived is collapsed", () => {
    const tree = ProjectsList(props());
    const shown = texts(tree);
    expect(shown).toEqual(
      expect.arrayContaining([
        "Open",
        "Older than 6 weeks",
        "Sent",
        "Archived (1)",
        "Sent after 4 sessions · 5 attempts",
        "5 attempts · Tried in 2 sessions",
      ]),
    );
    expect(shown.indexOf("6B · Red")).toBeLessThan(
      shown.indexOf("Older than 6 weeks"),
    );
    expect(shown.indexOf("Older than 6 weeks")).toBeLessThan(
      shown.indexOf("6C"),
    );
    expect(shown).not.toContain("7A · Red");
    expect(
      findAll(tree, (n) => n.type === "HoldColourSwatch").map(
        (n) => n.props.colour,
      ),
    ).toEqual(["red", "red"]);
  });

  it("offers Archive for open projects, Reopen for archived and nothing for sent", () => {
    const p = props({ archivedOpen: true });
    const tree = ProjectsList(p);
    const buttons = findAll(tree, (n) => n.type === "Button");
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual([
      "Archive project 6B · Red",
      "Archive project 6C",
      "Reopen project 7A · Red",
    ]);
    buttons[0].props.onPress();
    buttons[2].props.onPress();
    expect(p.onArchive).toHaveBeenNthCalledWith(1, open, true);
    expect(p.onArchive).toHaveBeenNthCalledWith(2, archived, false);
  });

  it("disables the row being changed and toggles the archived section", () => {
    const p = props({ busyId: open.id });
    const tree = ProjectsList(p);
    const archive = findAll(tree, (n) => n.type === "Button")[0];
    expect(archive.props.disabled).toBe(true);
    const toggle = findAll(
      tree,
      (n) => n.type === "Pressable" && n.props.accessibilityRole === "button",
    )[0];
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    toggle.props.onPress();
    expect(p.onToggleArchived).toHaveBeenCalled();
  });

  it("explains how projects start when none are open", () => {
    const tree = ProjectsList(props({ projects: [sent] }));
    expect(texts(tree)[0]).toMatch(/Not yet becomes a project/);
  });
});

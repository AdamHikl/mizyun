import { Pressable, StyleSheet, View } from "react-native";
import type { BoulderProjectRecord } from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { Button, Icon } from "@/components/ui";
import { MinTouchTarget, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { HoldColourSwatch } from "./log-boulder-sheet";
import {
  groupProjects,
  projectAccessibilityLabel,
  projectName,
  projectSubtitle,
} from "./progress";

function ProjectRow({
  project,
  busy,
  onArchive,
}: {
  project: BoulderProjectRecord;
  busy: boolean;
  onArchive?: (project: BoulderProjectRecord, archived: boolean) => void;
}) {
  const theme = useTheme();
  const action =
    project.status === "open"
      ? { label: "Archive", archived: true }
      : project.status === "archived"
        ? { label: "Reopen", archived: false }
        : null;
  return (
    <View
      style={[styles.row, { borderBottomColor: theme.separator }]}
      testID={`project-${project.id}`}
    >
      <View
        style={styles.rowText}
        accessible
        accessibilityLabel={projectAccessibilityLabel(project)}
      >
        <View style={styles.title}>
          {project.holdColour ? (
            <HoldColourSwatch colour={project.holdColour} size={14} />
          ) : null}
          <ThemedText type="smallBold">{projectName(project)}</ThemedText>
          {project.status === "sent" ? (
            <Icon name="checkCircle" size={14} color="primary" />
          ) : null}
        </View>
        <ThemedText type="footnote" themeColor="textSecondary">
          {projectSubtitle(project)}
        </ThemedText>
      </View>
      {action && onArchive ? (
        <Button
          label={action.label}
          variant="plain"
          size="small"
          disabled={busy}
          loading={busy}
          accessibilityLabel={`${action.label} project ${projectName(project, true)}`}
          onPress={() => onArchive(project, action.archived)}
        />
      ) : null}
    </View>
  );
}

function Group({
  title,
  projects,
  busyId,
  onArchive,
}: {
  title: string;
  projects: readonly BoulderProjectRecord[];
  busyId: string | null;
  onArchive?: (project: BoulderProjectRecord, archived: boolean) => void;
}) {
  if (projects.length === 0) return null;
  return (
    <View style={styles.group}>
      <ThemedText
        type="footnote"
        themeColor="textSecondary"
        accessibilityRole="header"
      >
        {title}
      </ThemedText>
      {projects.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          busy={busyId === project.id}
          onArchive={onArchive}
        />
      ))}
    </View>
  );
}

/**
 * Projects (ADR-0066 §6): open ones (grade, colour, attempts, sessions), the
 * ones not tried for six weeks grouped separately, sent ones with "Sent after N
 * sessions", and archived ones collapsed. Stateless; the screen owns requests.
 */
export function ProjectsList({
  projects,
  busyId = null,
  archivedOpen,
  onToggleArchived,
  onArchive,
}: {
  projects: readonly BoulderProjectRecord[];
  busyId?: string | null;
  archivedOpen: boolean;
  onToggleArchived: () => void;
  onArchive: (project: BoulderProjectRecord, archived: boolean) => void;
}) {
  const groups = groupProjects(projects);
  const noOpen = groups.open.length === 0 && groups.older.length === 0;
  return (
    <View style={styles.list}>
      {noOpen ? (
        <ThemedText type="small" themeColor="textSecondary">
          No open projects. A boulder logged as Not yet becomes a project.
        </ThemedText>
      ) : null}
      <Group
        title="Open"
        projects={groups.open}
        busyId={busyId}
        onArchive={onArchive}
      />
      <Group
        title="Older than 6 weeks"
        projects={groups.older}
        busyId={busyId}
        onArchive={onArchive}
      />
      <Group title="Sent" projects={groups.sent} busyId={busyId} />
      {groups.archived.length > 0 ? (
        <View style={styles.group}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Archived projects, ${groups.archived.length}`}
            accessibilityState={{ expanded: archivedOpen }}
            onPress={onToggleArchived}
            style={styles.toggle}
          >
            <Icon
              name={archivedOpen ? "chevronDown" : "chevronRight"}
              size={14}
              color="textSecondary"
            />
            <ThemedText type="footnote" themeColor="textSecondary">
              Archived ({groups.archived.length})
            </ThemedText>
          </Pressable>
          {archivedOpen
            ? groups.archived.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  busy={busyId === project.id}
                  onArchive={onArchive}
                />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three },
  group: { gap: Spacing.one },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: MinTouchTarget,
    paddingVertical: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: Spacing.half },
  title: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: MinTouchTarget,
  },
});

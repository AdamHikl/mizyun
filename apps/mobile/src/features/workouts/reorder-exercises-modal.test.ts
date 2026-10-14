import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatExerciseTargetSummary,
  ReorderExerciseItem,
  ReorderExercisesModal,
} from "./reorder-exercises-modal";

vi.mock("react-native", () => ({
  Modal: "Modal",
  Platform: {
    select: (options: Record<string, unknown>) =>
      options.ios ?? options.default,
    OS: "ios",
  },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: {
    create: (styles: unknown) => styles,
  },
  View: "View",
}));

vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Chip: "Chip",
  FormField: "FormField",
  FormTextInput: "FormTextInput",
  Icon: "Icon",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  Notice: "Notice",
  SectionHeader: "SectionHeader",
}));

vi.mock("@/components/themed-text", () => ({
  ThemedText: (props: any) => ({ type: "ThemedText", props }),
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    background: "#0B0F12",
    backgroundElement: "#161D22",
    backgroundSelected: "#222D35",
    border: "#334155",
    primary: "#10B981",
    text: "#F8FAFC",
    textSecondary: "#94A3B8",
  }),
}));

function findElementsByProp(
  node: any,
  predicate: (props: any) => boolean,
): any[] {
  const matches: any[] = [];
  if (!node) return matches;
  if (node.props && predicate(node.props)) {
    matches.push(node);
  }
  if (node.props && node.props.children) {
    const children = Array.isArray(node.props.children)
      ? node.props.children
      : [node.props.children];
    for (const child of children) {
      matches.push(...findElementsByProp(child, predicate));
    }
  }
  return matches;
}

function findByAccessibilityLabel(node: any, label: string): any | undefined {
  const results = findElementsByProp(
    node,
    (props) => props.accessibilityLabel === label,
  );
  return results[0];
}

describe("formatExerciseTargetSummary", () => {
  it("formats target sets only", () => {
    expect(
      formatExerciseTargetSummary({ id: "1", name: "Squat", targetSets: 3 }),
    ).toBe("3 sets");
    expect(
      formatExerciseTargetSummary({ id: "1", name: "Squat", targetSets: 1 }),
    ).toBe("1 set");
  });

  it("formats target sets and reps range", () => {
    expect(
      formatExerciseTargetSummary({
        id: "1",
        name: "Bench Press",
        targetSets: 4,
        repsMin: 8,
        repsMax: 12,
      }),
    ).toBe("4 sets · 8-12 reps");
  });

  it("formats target sets and exact reps when min equals max", () => {
    expect(
      formatExerciseTargetSummary({
        id: "1",
        name: "Deadlift",
        targetSets: 3,
        repsMin: 5,
        repsMax: 5,
      }),
    ).toBe("3 sets · 5 reps");
  });

  it("formats open-ended rep targets", () => {
    expect(
      formatExerciseTargetSummary({
        id: "1",
        name: "Pull-ups",
        repsMin: 10,
      }),
    ).toBe("10+ reps");

    expect(
      formatExerciseTargetSummary({
        id: "2",
        name: "Push-ups",
        repsMax: 25,
      }),
    ).toBe("up to 25 reps");
  });

  it("returns null if no targets are specified", () => {
    expect(formatExerciseTargetSummary({ id: "1", name: "Plank" })).toBeNull();
  });
});

describe("ReorderExercisesModal", () => {
  const sampleExercises: ReadonlyArray<ReorderExerciseItem> = [
    {
      id: "ex-1",
      name: "Barbell Squat",
      targetSets: 3,
      repsMin: 6,
      repsMax: 8,
    },
    {
      id: "ex-2",
      name: "Bench Press",
      targetSets: 4,
      repsMin: 8,
      repsMax: 10,
    },
    {
      id: "ex-3",
      name: "Barbell Row",
      targetSets: 3,
      repsMin: 10,
      repsMax: 12,
    },
  ];

  let onMoveExercise: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onMoveExercise = vi.fn();
    onClose = vi.fn();
  });

  it("renders a valid modal element tree", () => {
    const element = ReorderExercisesModal({
      visible: true,
      exercises: sampleExercises,
      onMoveExercise,
      onClose,
    });

    expect(element).toBeDefined();
    expect(element.type).toBe("Modal");
    expect(element.props.visible).toBe(true);
  });

  it("calls onMoveExercise with proper indices when pressing Move Up and Move Down", () => {
    const element = ReorderExercisesModal({
      visible: true,
      exercises: sampleExercises,
      onMoveExercise,
      onClose,
    });

    // Middle item (index 1: Bench Press) moving up to index 0
    const moveBenchUp = findByAccessibilityLabel(
      element,
      "Move Bench Press up",
    );
    expect(moveBenchUp).toBeDefined();
    expect(moveBenchUp.props.disabled).toBe(false);
    moveBenchUp.props.onPress();
    expect(onMoveExercise).toHaveBeenCalledWith(1, 0);

    // Middle item (index 1: Bench Press) moving down to index 2
    const moveBenchDown = findByAccessibilityLabel(
      element,
      "Move Bench Press down",
    );
    expect(moveBenchDown).toBeDefined();
    expect(moveBenchDown.props.disabled).toBe(false);
    moveBenchDown.props.onPress();
    expect(onMoveExercise).toHaveBeenCalledWith(1, 2);
  });

  it("prevents the first item from being moved up", () => {
    const element = ReorderExercisesModal({
      visible: true,
      exercises: sampleExercises,
      onMoveExercise,
      onClose,
    });

    const moveFirstUp = findByAccessibilityLabel(
      element,
      "Move Barbell Squat up",
    );
    expect(moveFirstUp).toBeDefined();
    expect(moveFirstUp.props.disabled).toBe(true);
    expect(moveFirstUp.props.accessibilityState).toEqual({ disabled: true });

    // Pressing disabled button must not call onMoveExercise
    moveFirstUp.props.onPress();
    expect(onMoveExercise).not.toHaveBeenCalled();
  });

  it("prevents the last item from being moved down", () => {
    const element = ReorderExercisesModal({
      visible: true,
      exercises: sampleExercises,
      onMoveExercise,
      onClose,
    });

    const moveLastDown = findByAccessibilityLabel(
      element,
      "Move Barbell Row down",
    );
    expect(moveLastDown).toBeDefined();
    expect(moveLastDown.props.disabled).toBe(true);
    expect(moveLastDown.props.accessibilityState).toEqual({ disabled: true });

    // Pressing disabled button must not call onMoveExercise
    moveLastDown.props.onPress();
    expect(onMoveExercise).not.toHaveBeenCalled();
  });

  it("calls onClose when the Done button is pressed", () => {
    const element = ReorderExercisesModal({
      visible: true,
      exercises: sampleExercises,
      onMoveExercise,
      onClose,
    });

    const doneButton = findByAccessibilityLabel(element, "Done");
    expect(doneButton).toBeDefined();
    doneButton.props.onPress();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the header close button is pressed", () => {
    const element = ReorderExercisesModal({
      visible: true,
      exercises: sampleExercises,
      onMoveExercise,
      onClose,
    });

    const closeButton = findByAccessibilityLabel(
      element,
      "Close reorder exercises modal",
    );
    expect(closeButton).toBeDefined();
    closeButton.props.onPress();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders empty state message when no exercises are provided", () => {
    const element = ReorderExercisesModal({
      visible: true,
      exercises: [],
      onMoveExercise,
      onClose,
    });

    const textNodes = findElementsByProp(
      element,
      (props) => props.children === "No exercises in current workout session.",
    );
    expect(textNodes.length).toBeGreaterThan(0);
  });
});

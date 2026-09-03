import type { Exercise, Workout, WorkoutSet } from "@mizyun/contracts";
import { EXERCISE_CATALOG, type CatalogExercise } from "@mizyun/core";

const previewExercises: Exercise[] = EXERCISE_CATALOG.slice(0, 100).map(
  (c: CatalogExercise, index: number) => ({
    id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    userId: "00000000-0000-0000-0000-000000000001",
    name: c.name,
    instructions: c.instructions ? c.instructions.join("\n") : null,
    metadata: {
      movementPattern: c.movementPattern,
      category: c.category ?? "strength",
      primaryMuscles: [...c.primaryMuscles],
      secondaryMuscles: [...c.secondaryMuscles],
      equipment: [...c.equipment],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
);

const initialWorkout: Workout = {
  id: "00000000-0000-0000-0000-000000000100",
  userId: "00000000-0000-0000-0000-000000000001",
  name: "Upper Body Hypertrophy",
  source: "manual",
  notes: "Focus on controlled eccentrics and progressive overload.",
  startedAt: new Date().toISOString(),
  completedAt: null,
  details: {
    coachPlan: {
      exercises: [
        {
          name: "Barbell Bench Press",
          catalogId: "barbell_bench_press",
          movementPattern: "horizontal_push",
          sets: 3,
          targetSets: 3,
          targetReps: "8-12",
          repsMin: 8,
          repsMax: 12,
          targetLoad: "80 kg",
          restSeconds: 90,
          notes: "Warm up with bar, progressive pyramid",
        },
        {
          name: "Incline Dumbbell Press",
          catalogId: "incline_dumbbell_press",
          movementPattern: "horizontal_push",
          sets: 3,
          targetSets: 3,
          targetReps: "10-12",
          repsMin: 10,
          repsMax: 12,
          targetLoad: "28 kg",
          restSeconds: 90,
          notes: "30-degree bench angle",
        },
        {
          name: "Seated Cable Row",
          catalogId: "seated_cable_row",
          movementPattern: "horizontal_pull",
          sets: 3,
          targetSets: 3,
          targetReps: "10-12",
          repsMin: 10,
          repsMax: 12,
          targetLoad: "60 kg",
          restSeconds: 90,
          notes: "Pause 1s at torso contraction",
        },
        {
          name: "Overhead Triceps Extension",
          catalogId: "overhead_triceps_extension",
          movementPattern: "accessory",
          sets: 3,
          targetSets: 3,
          targetReps: "12-15",
          repsMin: 12,
          repsMax: 15,
          targetLoad: "20 kg",
          restSeconds: 60,
          notes: "Keep elbows tucked",
        },
      ],
    },
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const previewWorkoutStore = {
  workouts: [initialWorkout] as Workout[],
  sets: [] as WorkoutSet[],
  exercises: previewExercises,

  getWorkouts(): Workout[] {
    return [...this.workouts];
  },

  getWorkout(id: string): Workout | null {
    return this.workouts.find((w) => w.id === id) ?? null;
  },

  getSets(workoutId?: string): WorkoutSet[] {
    return workoutId
      ? this.sets.filter((s) => s.workoutId === workoutId)
      : [...this.sets];
  },

  getExercises(): Exercise[] {
    return [...this.exercises];
  },

  addWorkout(workout: Workout): Workout {
    this.workouts.unshift(workout);
    return workout;
  },

  updateWorkout(id: string, patch: Partial<Workout>): Workout | null {
    const index = this.workouts.findIndex((w) => w.id === id);
    if (index === -1) return null;
    const updated = {
      ...this.workouts[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    } as Workout;
    this.workouts[index] = updated;
    return updated;
  },

  addSet(set: WorkoutSet): WorkoutSet {
    this.sets.push(set);
    return set;
  },

  deleteSet(id: string): boolean {
    const index = this.sets.findIndex((s) => s.id === id);
    if (index === -1) return false;
    this.sets.splice(index, 1);
    return true;
  },

  addExercise(exercise: Exercise): Exercise {
    this.exercises.push(exercise);
    return exercise;
  },
};

import { describe, expect, it, vi } from "vitest";

vi.mock("expo-router", () => ({
  router: {
    push: vi.fn(),
  },
}));

import {
  getAvailableSettings,
  getSettingById,
  getSettingsByDestination,
  getSettingsForCategory,
  isSettingAvailable,
  SETTINGS_CATALOG,
  SETTINGS_CATEGORIES,
  type SettingsAvailabilityContext,
  type SettingsCatalogItem,
} from "./settings-catalog";
import {
  ALLOWED_EXTERNAL_ROUTES,
  isAllowedExternalRoute,
  isSettingsDetailKey,
  SETTINGS_DETAIL_CONFIGS,
  type SettingsDetailKey,
} from "./settings-destinations";

describe("settings-catalog", () => {
  it("keeps health previews out of Production/default and signed-out settings", () => {
    const context: SettingsAvailabilityContext = {
      isSignedIn: true,
      hasProfile: true,
      isProgressPhotosEnabled: false,
      isSetupComplete: true,
    };
    expect(
      getAvailableSettings(context).some(
        (item) => item.id === "health-preview",
      ),
    ).toBe(false);
    expect(
      getAvailableSettings({ ...context, isHealthPreviewEnabled: true }).some(
        (item) => item.id === "health-preview",
      ),
    ).toBe(true);
    expect(
      getAvailableSettings({
        ...context,
        isSignedIn: false,
        isHealthPreviewEnabled: true,
      }).some((item) => item.id === "health-preview"),
    ).toBe(false);
  });
  describe("catalog integrity and uniqueness", () => {
    it("ensures all items in SETTINGS_CATALOG have unique id values", () => {
      const ids = SETTINGS_CATALOG.map((item) => item.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it("ensures all categoryId values match known SETTINGS_CATEGORIES ids", () => {
      const validCategoryIds = new Set(SETTINGS_CATEGORIES.map((c) => c.id));
      expect(validCategoryIds.size).toBe(7);

      for (const item of SETTINGS_CATALOG) {
        expect(
          validCategoryIds.has(item.categoryId),
          `Item '${item.id}' has invalid categoryId '${item.categoryId}'`,
        ).toBe(true);
      }
    });

    it("ensures all SETTINGS_CATEGORIES have unique ids, non-empty titles, icons, and descriptions", () => {
      const categoryIds = SETTINGS_CATEGORIES.map((c) => c.id);
      const uniqueIds = new Set(categoryIds);
      expect(categoryIds.length).toBe(uniqueIds.size);

      for (const category of SETTINGS_CATEGORIES) {
        expect(category.title.trim().length).toBeGreaterThan(0);
        expect(category.icon.trim().length).toBeGreaterThan(0);
        expect(category.shortDescription.trim().length).toBeGreaterThan(0);
        expect(category.exampleItems.length).toBeGreaterThan(0);
      }
    });

    it("ensures all items have valid targetType, non-empty label, description, and breadcrumb", () => {
      const validTargetTypes = new Set([
        "setting-detail",
        "external-route",
        "action",
      ]);

      for (const item of SETTINGS_CATALOG) {
        expect(validTargetTypes.has(item.targetType)).toBe(true);
        expect(item.label.trim().length).toBeGreaterThan(0);
        expect(item.description.trim().length).toBeGreaterThan(0);
        expect(item.breadcrumb.trim().length).toBeGreaterThan(0);
        expect(item.categoryLabel.trim().length).toBeGreaterThan(0);
        expect(Array.isArray(item.aliases)).toBe(true);
        expect(Array.isArray(item.intentPhrases)).toBe(true);
      }
    });

    it("validates external-route targetType items have targetRoute in ALLOWED_EXTERNAL_ROUTES", () => {
      const externalItems = SETTINGS_CATALOG.filter(
        (item) => item.targetType === "external-route",
      );
      expect(externalItems.length).toBeGreaterThan(0);

      for (const item of externalItems) {
        expect(
          item.targetRoute,
          `Item '${item.id}' missing targetRoute`,
        ).toBeDefined();
        expect(
          isAllowedExternalRoute(item.targetRoute!),
          `Item '${item.id}' has disallowed external route '${item.targetRoute}'`,
        ).toBe(true);
      }
    });

    it("validates action targetType items have recognized actionId", () => {
      const actionItems = SETTINGS_CATALOG.filter(
        (item) => item.targetType === "action",
      );
      expect(actionItems.length).toBeGreaterThan(0);

      const validActions = new Set(["sign-out", "open-onboarding"]);
      for (const item of actionItems) {
        expect(item.actionId).toBeDefined();
        expect(validActions.has(item.actionId!)).toBe(true);
      }
    });
  });

  describe("detail destinations and valid anchors", () => {
    it("ensures all settingDetailKey values exist in SETTINGS_DETAIL_CONFIGS", () => {
      const detailItems = SETTINGS_CATALOG.filter(
        (item) => item.targetType === "setting-detail",
      );
      expect(detailItems.length).toBeGreaterThan(0);

      for (const item of detailItems) {
        expect(
          item.settingDetailKey,
          `Item '${item.id}' missing settingDetailKey`,
        ).toBeDefined();
        expect(
          isSettingsDetailKey(item.settingDetailKey!),
          `Item '${item.id}' has unknown settingDetailKey '${item.settingDetailKey}'`,
        ).toBe(true);
      }
    });

    it("ensures all anchorId values are listed in validAnchors for their detail destination", () => {
      const anchoredItems = SETTINGS_CATALOG.filter(
        (item) =>
          item.targetType === "setting-detail" && item.anchorId !== undefined,
      );
      expect(anchoredItems.length).toBeGreaterThan(0);

      for (const item of anchoredItems) {
        const configKey = item.settingDetailKey as SettingsDetailKey;
        const config = SETTINGS_DETAIL_CONFIGS[configKey];
        expect(
          config,
          `Detail config missing for '${configKey}'`,
        ).toBeDefined();
        expect(
          config.validAnchors.includes(item.anchorId!),
          `Item '${item.id}' has anchor '${item.anchorId}' not in validAnchors for '${configKey}' [${config.validAnchors.join(", ")}]`,
        ).toBe(true);
      }
    });
  });

  describe("isSettingAvailable", () => {
    const defaultContext: SettingsAvailabilityContext = {
      isSignedIn: false,
      hasProfile: false,
      isProgressPhotosEnabled: false,
      isSetupComplete: true,
    };

    it("always rule returns true regardless of context", () => {
      const alwaysItem: SettingsCatalogItem = {
        id: "test-always",
        destinationId: "test",
        label: "Always Visible",
        description: "Test",
        categoryId: "profile-goals",
        categoryLabel: "Profile & goals",
        breadcrumb: "Test",
        aliases: [],
        intentPhrases: [],
        targetType: "action",
        availabilityRule: "always",
      };

      expect(isSettingAvailable(alwaysItem, defaultContext)).toBe(true);
      expect(
        isSettingAvailable(alwaysItem, { ...defaultContext, isSignedIn: true }),
      ).toBe(true);
    });

    it("signed-in rule depends strictly on isSignedIn", () => {
      const signedInItem: SettingsCatalogItem = {
        id: "test-signed-in",
        destinationId: "test",
        label: "Signed-in only",
        description: "Test",
        categoryId: "account-help",
        categoryLabel: "Account & help",
        breadcrumb: "Test",
        aliases: [],
        intentPhrases: [],
        targetType: "action",
        availabilityRule: "signed-in",
      };

      expect(
        isSettingAvailable(signedInItem, {
          ...defaultContext,
          isSignedIn: false,
        }),
      ).toBe(false);
      expect(
        isSettingAvailable(signedInItem, {
          ...defaultContext,
          isSignedIn: true,
        }),
      ).toBe(true);
    });

    it("has-profile rule depends strictly on hasProfile", () => {
      const profileItem: SettingsCatalogItem = {
        id: "test-profile",
        destinationId: "test",
        label: "Profile required",
        description: "Test",
        categoryId: "profile-goals",
        categoryLabel: "Profile & goals",
        breadcrumb: "Test",
        aliases: [],
        intentPhrases: [],
        targetType: "setting-detail",
        availabilityRule: "has-profile",
      };

      expect(
        isSettingAvailable(profileItem, {
          ...defaultContext,
          hasProfile: false,
        }),
      ).toBe(false);
      expect(
        isSettingAvailable(profileItem, {
          ...defaultContext,
          hasProfile: true,
        }),
      ).toBe(true);
    });

    it("progress-photos rule depends strictly on isProgressPhotosEnabled", () => {
      const photosItem: SettingsCatalogItem = {
        id: "test-photos",
        destinationId: "test",
        label: "Photos required",
        description: "Test",
        categoryId: "profile-goals",
        categoryLabel: "Profile & goals",
        breadcrumb: "Test",
        aliases: [],
        intentPhrases: [],
        targetType: "external-route",
        availabilityRule: "progress-photos",
      };

      expect(
        isSettingAvailable(photosItem, {
          ...defaultContext,
          isProgressPhotosEnabled: false,
        }),
      ).toBe(false);
      expect(
        isSettingAvailable(photosItem, {
          ...defaultContext,
          isProgressPhotosEnabled: true,
        }),
      ).toBe(true);
    });

    it("incomplete-setup rule depends strictly on !isSetupComplete", () => {
      const setupItem: SettingsCatalogItem = {
        id: "test-setup",
        destinationId: "test",
        label: "Setup Wizard",
        description: "Test",
        categoryId: "account-help",
        categoryLabel: "Account & help",
        breadcrumb: "Test",
        aliases: [],
        intentPhrases: [],
        targetType: "action",
        availabilityRule: "incomplete-setup",
      };

      expect(
        isSettingAvailable(setupItem, {
          ...defaultContext,
          isSetupComplete: true,
        }),
      ).toBe(false);
      expect(
        isSettingAvailable(setupItem, {
          ...defaultContext,
          isSetupComplete: false,
        }),
      ).toBe(true);
    });
  });

  describe("helper lookup functions", () => {
    const fullContext: SettingsAvailabilityContext = {
      isSignedIn: true,
      hasProfile: true,
      isProgressPhotosEnabled: true,
      isHealthPreviewEnabled: true,
      isSetupComplete: true,
    };

    it("getAvailableSettings returns all items available under full context", () => {
      const available = getAvailableSettings(fullContext);
      // Incomplete-setup item (setup-wizard) is excluded when setup is complete
      expect(available.length).toBe(SETTINGS_CATALOG.length - 1);
      expect(available.every((item) => item.id !== "setup-wizard")).toBe(true);
    });

    it("getSettingsForCategory returns items filtered by category", () => {
      const appearanceItems = getSettingsForCategory("appearance", fullContext);
      expect(appearanceItems.length).toBe(1);
      expect(appearanceItems[0].id).toBe("theme");

      const workoutsItems = getSettingsForCategory(
        "workouts-reminders",
        fullContext,
      );
      expect(workoutsItems.length).toBeGreaterThanOrEqual(4);
      expect(
        workoutsItems.every((item) => item.categoryId === "workouts-reminders"),
      ).toBe(true);
    });

    it("getSettingById returns matching item or undefined", () => {
      const theme = getSettingById("theme");
      expect(theme).toBeDefined();
      expect(theme?.label).toBe("Appearance & Theme");

      const missing = getSettingById("non-existent-id");
      expect(missing).toBeUndefined();
    });

    it("getSettingsByDestination returns all items pointing to given destinationId", () => {
      const memoryItems = getSettingsByDestination("memory");
      // coach-memory and coach-memory-privacy both point to destinationId: "memory"
      expect(memoryItems.length).toBe(2);
      expect(memoryItems.every((item) => item.destinationId === "memory")).toBe(
        true,
      );

      const emptyItems = getSettingsByDestination("unknown-destination");
      expect(emptyItems).toEqual([]);
    });
  });
});

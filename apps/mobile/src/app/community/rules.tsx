import { Stack } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

export default function CommunityRulesScreen() {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: "Community rules & privacy" }} />
      <ThemedText type="subtitle">Community rules & privacy</ThemedText>
      <ThemedText>
        Rules version: 2026-09-30. Enrollment is closed while safety contact,
        legal review and pilot acceptance are pending.
      </ThemedText>
      <ThemedText>
        Community is optional. Declining or leaving preserves private tracking,
        Coach access and paid entitlement. Adult declaration, these rules,
        exact-handle discovery, follow approvals, every publication and
        notification permission are separate choices.
      </ThemedText>
      <ThemedText>
        Choose a separate social name, handle and initials. Your private profile
        is not copied. With only a birth year, a whole birth year at least 19
        years before the current UTC year passes the conservative check. A birth
        year 18 years before the current year must wait until the next UTC year.
        The check does not verify identity or birthday.
      </ThemedText>
      <ThemedText>
        Your currently approved followers can see still-shared earlier cards and
        future cards you deliberately share. Following is directional. Saving a
        private workout never shares it. Search is off by default; a valid
        invite can let someone request to follow you even with search off. Your
        handle cannot change during the pilot.
      </ThemedText>
      <ThemedText>
        Do not harass, threaten, impersonate or spam people. Hate, sexual
        exploitation including child abuse, unsolicited solicitation and
        invasive disclosure of someone else's information are prohibited. Keep
        sensitive health details, links, emails and phone contact information
        out of social text. Profile text is subject to filtering and moderation.
      </ThemedText>
      <ThemedText>
        A handle, workout day or optional duration can identify you or reveal
        habits. Community has no access to private health integrations or Coach
        context. Social photos, comments and direct messages are outside this
        pilot.
      </ThemedText>
      <ThemedText>
        Leaving immediately hides your profile and cards, ends follows and
        pending requests, revokes invitations and stops social delivery.
        Rejoining requires fresh choices and creates a new enrollment
        generation; it restores no follows, shared cards, invitations or
        reactions. Blocks and account restrictions remain.
      </ThemedText>
      <ThemedText>
        Selected retention limits: withdrawn profile text and revoked card
        payloads are purged within 30 days; shared cards expire after at most
        365 days; terms receipts after withdrawal have a 30-day maximum except a
        disclosed justified case hold. Minimal handle reservation, preferences,
        safety blocks and generation remain for the account lifetime. A
        deleted-account handle has a 90-day quarantine. Encrypted recovery
        archives remain up to 90 days, with newer deletion and revocation state
        applied before a restore serves users.
      </ThemedText>
      <ThemedText>
        Export and account deletion remain available through Account settings.
        Community retention, export and restore acceptance are pending;
        enrollment stays closed until those checks and the full disclosures are
        accepted.
      </ThemedText>
      <ThemedText>
        Community safety contact, reporting coverage and independent appeals are
        not verified yet. The existing Account help route is general support.
        For imminent danger, contact your local emergency services.
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 18, paddingBottom: 40 },
});

import { StyleSheet } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { CommunityPage } from "@/features/community";
import { COMMUNITY_ENROLLMENT_OPEN } from "@/composition/community-admission";

export default function CommunityRulesScreen() {
  return (
    <CommunityPage
      title="Community rules & privacy"
      backHref="/community/settings"
      description="Clear choices and respect for each other."
    >
      <ThemedText>
        Rules version: 2026-09-30.{" "}
        {COMMUNITY_ENROLLMENT_OPEN
          ? "Community is open to adults with a Mizyun account. The full Community Standards are published at www.phiskel.com/mizyun/community-standards."
          : "Community enrollment is not available in this build."}
      </ThemedText>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        Your choice
      </ThemedText>
      <ThemedText>
        Community is optional. Declining or leaving preserves private tracking,
        Coach access and paid entitlement. Adult declaration, these rules,
        exact-handle discovery, follow approvals, every publication and
        notification permission are separate choices.
      </ThemedText>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        Your Community identity
      </ThemedText>
      <ThemedText>
        Choose a separate social name, handle and initials. Your private profile
        is not copied. With only a birth year, a whole birth year at least 19
        years before the current UTC year passes the conservative check. A birth
        year 18 years before the current year must wait until the next UTC year.
        The check does not verify identity or birthday.
      </ThemedText>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        Who can see shared meals and workouts
      </ThemedText>
      <ThemedText>
        Your currently approved followers can see still-shared earlier cards and
        future cards you deliberately share. Following is directional. Saving a
        private meal or workout never shares it. Search is off by default; a
        valid invite can let someone request to follow you even with search off.
        Your handle cannot be changed after you choose it.
      </ThemedText>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        Respect each other
      </ThemedText>
      <ThemedText>
        Do not harass, threaten, impersonate or spam people. Hate, sexual
        exploitation including child abuse, unsolicited solicitation and
        invasive disclosure of someone else's information are prohibited. Keep
        sensitive health details, links, emails and phone contact information
        out of social text. Profile text is subject to filtering and moderation.
      </ThemedText>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        What stays private
      </ThemedText>
      <ThemedText>
        A handle, meal or workout day or optional duration can identify you or
        reveal habits. Community has no access to private health integrations or
        Coach context. A separate, optional sharing choice can include completed
        exercises, set types, reps, weights and set durations. Preview every
        field before confirming; custom exercise names can reveal personal
        information. Workout titles and notes stay private. Existing summary
        cards are never automatically expanded. A separate meal preview shares
        its name and day; nutrition is optional and starts off. Meal notes,
        tracking photos and Coach metadata stay private. Editing or deleting a
        shared source meal removes the post until you choose to share again.
      </ThemedText>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        Optional features
      </ThemedText>
      <ThemedText>
        Where available, comments and mentions, private groups, cooperative
        challenges, messages, photos, routine sharing and broader handle search
        each have separate choices. Joining Community enables none of them
        automatically. Messages require mutual following and both people to opt
        in. Group history starts with your current membership. Photos are
        separately selected and held for moderation before sharing; your private
        tracking photos are never uploaded automatically. Routine imports create
        independent private copies. Broader search is separately opted in and
        bounded; there is no public feed or contact upload.
      </ThemedText>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        Leaving and returning
      </ThemedText>
      <ThemedText>
        Leaving immediately hides your profile and cards, ends follows and
        pending requests, revokes invitations and stops social delivery.
        Rejoining requires fresh choices and creates a new enrollment
        generation; it restores no follows, shared cards, invitations or
        reactions. Blocks and account restrictions remain.
      </ThemedText>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        Data and retention
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
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        Export and deletion
      </ThemedText>
      <ThemedText>
        Export and account deletion are available in Account settings. Your
        Community data is included in the export and removed when you delete
        your account.
      </ThemedText>
      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>
        Help and safety
      </ThemedText>
      <ThemedText>
        Report a person or card from its menu. Mizyun's moderator reviews
        reports. The safety contact is under Community reports, appeals and
        safety contact in Community settings. For imminent danger, contact your
        local emergency services.
      </ThemedText>
    </CommunityPage>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 20, fontWeight: "700", marginTop: 12 },
});

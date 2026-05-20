export type UserProfile = {
  displayName: string;
  avatarUrl: string;
};

export function renderAvatarProfile(profile: UserProfile): string {
  return `${profile.displayName}:${profile.avatarUrl}`;
}

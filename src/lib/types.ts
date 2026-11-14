export type Role = "barista" | "owner" | "coffee_lover";
export const ROLE_LABEL: Record<Role, string> = {
  barista: "Barista",
  owner: "Cafe owner",
  coffee_lover: "Coffee lover",
};

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  role: Role | null;
  city: string | null;
  is_admin: boolean;
};
export type AuthorLite = Pick<Profile, "username" | "display_name" | "avatar_url" | "role">;

export type Cafe = {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string;
  address: string | null;
  description: string | null;
  menu_url: string | null;
  instagram: string | null;
  tiktok: string | null;
  website: string | null;
  photos: string[];
};

export type Community = { id: string; name: string; slug: string; cafe_id: string | null };

export type PostPhoto = {
  id: string;
  url: string;
  position: number;
  created_at?: string | null;
};

export type PostRow = {
  id: string;
  community_id: string;
  author_id: string;
  title: string;
  body: string | null;
  created_at: string;
  deleted_at: string | null;
  author: AuthorLite | null;
  comments: { count: number }[];
  photos?: PostPhoto[] | null;
};

export type CommentRow = {
  id: string;
  post_id: string;
  parent_comment_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  author: AuthorLite | null;
};

export type PresenceStatus = "online" | "away" | "offline";

export type ChatPerson = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type ChatMessage = {
  id: string;
  room_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

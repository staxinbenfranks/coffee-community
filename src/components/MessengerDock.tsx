import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchInbox } from "@/lib/chat";
import MessengerPanel from "./MessengerPanel";

export default async function MessengerDock() {
  const me = await getSessionProfile();
  if (!me) return null;
  const supabase = await createClient();
  const inbox = await fetchInbox(supabase, me.id);
  return (
    <MessengerPanel
      me={{ id: me.id, username: me.username, display_name: me.display_name, avatar_url: me.avatar_url }}
      initialBuddies={inbox.buddies}
      initialRooms={inbox.rooms}
      initialError={inbox.error}
    />
  );
}

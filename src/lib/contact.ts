// ---------------------------------------------------------------------------
// Contact-form submission — a thin wrapper over the Supabase `contact_messages`
// table (see supabase/migrations). RLS allows insert-only for everyone, so this
// works for signed-out visitors too; submissions are read in the dashboard.
// ---------------------------------------------------------------------------

import { supabase } from './supabase';

export interface ContactSubmission {
  /** Optional reply-to address the sender typed in. */
  email?: string;
  message: string;
}

/** Store a contact message. Throws on validation/transport errors. */
export async function submitContactMessage(input: ContactSubmission): Promise<void> {
  if (!supabase) throw new Error('Contact is unavailable in this build.');

  const message = input.message.trim();
  if (!message) throw new Error('Please enter a message.');
  if (message.length > 5000) throw new Error('Message is too long (5000 characters max).');

  const email = input.email?.trim() || null;

  const { error } = await supabase.from('contact_messages').insert({
    message,
    email,
    user_agent: navigator.userAgent.slice(0, 500),
  });
  if (error) throw error;
}

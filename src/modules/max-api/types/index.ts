// ─── Users ───

export interface MaxUser {
  user_id: number;
  name: string;
  username?: string;
  is_bot?: boolean;
  last_activity_time?: number;
}

// ─── Buttons ───

export interface MaxButtonCallback {
  type: 'callback';
  text: string;
  payload: string;
  intent?: 'default' | 'positive' | 'negative';
}

export interface MaxButtonLink {
  type: 'link';
  text: string;
  url: string;
  intent?: 'default' | 'positive' | 'negative';
}

export interface MaxButtonMessage {
  type: 'message';
  text: string;
  payload: string;
  intent?: 'default' | 'positive' | 'negative';
}

export interface MaxButtonClipboard {
  type: 'clipboard';
  text: string;
  payload: string;
}

export type MaxButton =
  | MaxButtonCallback
  | MaxButtonLink
  | MaxButtonMessage
  | MaxButtonClipboard;

/** Строка кнопок (до 7 кнопок, до 3 для link/open_app/request_geo_location/request_contact) */
export type MaxButtonRow = MaxButton[];

// ─── Attachments ───

export interface MaxInlineKeyboardAttachment {
  type: 'inline_keyboard';
  payload: {
    buttons: MaxButtonRow[];
  };
}

export interface MaxImagePayload {
  token: string;
}

export interface MaxImageAttachment {
  type: 'image';
  payload: MaxImagePayload;
}

export type MaxAttachment = MaxInlineKeyboardAttachment | MaxImageAttachment;

// ─── Message body ───

export interface NewMessageBody {
  text?: string;
  attachments?: MaxAttachment[];
  format?: 'markdown' | 'html';
  notify?: boolean;
  disable_link_preview?: boolean;
}

// ─── Update types ───

export interface MaxBotStartedUpdate {
  update_type: 'bot_started';
  timestamp: number;
  /** Пользователь, нажавший «Начать» */
  user: MaxUser;
  chat_id: number;
  /** Deep-link payload из ссылки запуска (если есть) */
  payload?: string;
}

export interface MaxMessageBody {
  mid: string;
  seq: number;
  text?: string;
}

export interface MaxMessageRecipient {
  chat_id: number;
  chat_type: string;
  user_id?: number;
}

export interface MaxMessageObject {
  sender: MaxUser;
  recipient: MaxMessageRecipient;
  timestamp: number;
  body: MaxMessageBody;
  stat?: { views: number };
}

export interface MaxMessageCreatedUpdate {
  update_type: 'message_created';
  timestamp: number;
  message: MaxMessageObject;
}

export interface MaxCallbackInfo {
  callback_id: string;
  /** Payload, переданный в кнопке */
  payload?: string;
  user: MaxUser;
  message?: MaxMessageObject;
  timestamp: number;
}

export interface MaxMessageCallbackUpdate {
  update_type: 'message_callback';
  timestamp: number;
  callback: MaxCallbackInfo;
}

export type MaxUpdate =
  | MaxBotStartedUpdate
  | MaxMessageCreatedUpdate
  | MaxMessageCallbackUpdate
  | { update_type: string; [key: string]: unknown };

// ─── API responses ───

export interface MaxSendMessageResponse {
  message: MaxMessageObject;
}

export interface MaxAnswerCallbackResponse {
  success: boolean;
  message?: string;
}

export interface MaxBotInfo {
  user_id: number;
  name: string;
  username: string;
  is_bot: boolean;
  last_activity_time: number;
  description?: string;
  avatar_url?: string;
}

export interface MaxUploadResponse {
  token: string;
  url?: string;
}

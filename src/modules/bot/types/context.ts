import { Context } from "telegraf";
import {
  Update,
  Message,
  CallbackQuery,
} from "telegraf/typings/core/types/typegram";

export interface SessionData {
  status?: string;
  targetTelegramId?: string;
  referrerId?: string;
  pendingAddPlanId?: number;
  pendingDeviceSubId?: string;
  [key: string]: any;
}

export interface CustomContext extends Context {
  session: SessionData;
}

export type MessageContext = Omit<CustomContext, "message"> & {
  update: Update.MessageUpdate;
  message: Message.TextMessage;
};

export type CallbackContext = Omit<CustomContext, "callbackQuery"> & {
  update: Update.CallbackQueryUpdate;
  callbackQuery: CallbackQuery.DataQuery;
};

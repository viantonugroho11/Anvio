import type { ChannelHub } from './channel-hub.js';
import type { WhatsAppChannel } from './whatsapp.js';

export interface ChannelHubBundle {
  hub: ChannelHub;
  whatsapp?: WhatsAppChannel;
}

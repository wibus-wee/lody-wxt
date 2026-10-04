import { createContext } from 'react';

import type { ConversationContentActions } from './specialized-content';

export const ConversationContentContext = createContext<ConversationContentActions>({});

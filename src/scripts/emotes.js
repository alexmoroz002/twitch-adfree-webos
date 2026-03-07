import { configRead } from '../config';
import { LOAD_EMOTES, USE_EMOTE_PROXY, EMOTE_PROXY_URL } from '../constants/config.constants';
import {
  tvClientId,
  twitchGraphQLEndpoint,
  xDeviceId
} from '../constants/requests.constants';
import { getAuthToken, getTwitchUsername } from '../utils/utils';
import { showNotification } from './ui';

(function () {
  // Constants
  const EMOTE_SIZE = '1x';
  const API_7TV = 'https://7tv.io/v3';
  const API_BTTV = 'https://api.betterttv.net/3/cached';
  const API_FFZ = 'https://api.frankerfacez.com/v1';
  let EMOTE_PROXY = ''
  const CHAT_SELECTOR = 'main > aside';
  const MESSAGE_SELECTOR = 'r-1xq2hnv';

  // Global variables
  let emoteMap7tv = new Map();
  let emoteMapBttv = new Map();
  let emoteMapFfz = new Map();
  let currentChannelLogin = null;
  let authToken = null;
  let loadingEmotes = false;
  let loadRequestId = 0;

  async function fetch7TVEmotes(userId) {
    try {
      const [res, globalRes] = await Promise.all([
        fetch(`${EMOTE_PROXY}${API_7TV}/users/twitch/${userId}`),
        fetch(`${EMOTE_PROXY}${API_7TV}/emote-sets/global`)
      ]);
      if (!res.ok || !globalRes.ok) {
        emoteMap7tv = new Map();
        return;
      }

      const data = await res.json();
      const globalData = await globalRes.json();
      const emotes = [...(data.emote_set?.emotes || []), ...(globalData.emotes || [])];

      if (emotes.length === 0) {
        return;
      }

      showNotification('7TV emotes loaded successfully!');

      emotes.forEach((emote) => {
        const url = `${EMOTE_PROXY}https:${emote.data.host.url}/${EMOTE_SIZE}.webp`;
        emoteMap7tv.set(emote.name, url);
      });
    } catch (err) {
      console.error('[7TV] Error wile fetching emotes:', err);
    }
  }

  async function fetchBTTVEmotes(userId) {
    try {
      const [res, globalRes] = await Promise.all([
        fetch(`${EMOTE_PROXY}${API_BTTV}/users/twitch/${userId}`),
        fetch(`${EMOTE_PROXY}${API_BTTV}/emotes/global`)
      ]);

      if (!res.ok || !globalRes.ok) {
        emoteMapBttv = new Map();
        return;
      }
      const data = await res.json();
      const globalData = await globalRes.json();

      const emotes = [
        ...(data.sharedEmotes || []),
        ...(data.channelEmotes || []),
        ...(globalData || []),
      ];
      if (emotes.length === 0) {
        return;
      }
      showNotification('BTTV emotes loaded successfully!');
      emotes.forEach((emote) => {
        const url = `${EMOTE_PROXY}https://cdn.betterttv.net/emote/${emote.id}/${EMOTE_SIZE}.${emote.imageType}`;
        emoteMapBttv.set(emote.code, url);
      });
    } catch (err) {
      console.error('[BTTV] Error wile fetching emotes:', err);
    }
  }

  async function fetchFFZEmotes(userId) {
    try {
      const [res, resGlobal] = await Promise.all([
        fetch(`${EMOTE_PROXY}${API_FFZ}/room/id/${userId}`),
        fetch(`${EMOTE_PROXY}${API_FFZ}/_set/global`)
      ]);
      if (!res.ok) {
        emoteMapFfz = new Map();
        return;
      }

      const data = await res.json();
      const emoteSetId = data.room.set;
      const globalSets = await resGlobal.json().default_sets || [];
      const emotes = [
        ...(data.sets[emoteSetId].emoticons || []),
        ...(await fetchFFZGlobalEmotes(globalSets) || [])
      ];
      // const emotes = data.sets[emoteSetId].emoticons;

      if (emotes.length === 0) {
        return;
      }

      showNotification('FFZ channel emotes loaded successfully!')
      emotes.forEach((emote) => {
        const url = `${EMOTE_PROXY}${emote.urls["1"]}`;
        emoteMapFfz.set(emote.name, url);
      });
    } catch (err) {
      console.error('[FFZ] Error wile fetching emotes:', err);
    }
  }

  async function fetchFFZGlobalEmotes(sets) {
    try {
      const globalSetResults = await Promise.allSettled(
        sets.map(async (set) => {
          const res = await fetch(`${EMOTE_PROXY}${API_FFZ}/_set/${set}`);
          if (!res.ok) {
            return [];
          }
          const data = await res.json();
          const emotes = data.emoticons || [];
          console.log(
            `[FFZ] Processed set ${set}, loaded global emotes:`,
            emotes.length
          );
          return emotes;
        })
      );

      const allEmotes = [];
      globalSetResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          allEmotes.push(...result.value);
        }
      });

      console.log(`[FFZ] Total global emotes loaded:`, allEmotes.length);
      return allEmotes;
    } catch (err) {
      console.error('[FFZ] Error while fetching emotes:', err);
      return [];
    }
  }

  async function fetchUserId(channelLogin) {
    const response = await fetch(twitchGraphQLEndpoint, {
      method: 'POST',
      headers: {
        'Client-ID': tvClientId,
        'X-Device-Id': xDeviceId,
        Authorization: authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        {
          operationName: 'GetUserID',
          variables: {
            login: channelLogin,
            lookupType: 'ACTIVE'
          },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash:
                'bf6c594605caa0c63522f690156aa04bd434870bf963deb76668c381d16fcaa5'
            }
          }
        }
      ])
    });

    if (!response.ok) {
      throw new Error(`Error fetching user ID: ${response.statusText}`);
    }

    const data = await response.json();
    return data[0]?.data?.user?.id;
  }

  async function loadEmotesForChannel(channelLogin) {
    if (loadingEmotes) {
      return;
    }

    loadingEmotes = true;
    const requestId = ++loadRequestId;

    try {
      authToken = getAuthToken();
      const userId = await fetchUserId(channelLogin);

      if (!userId || requestId !== loadRequestId) {
        return;
      }

      await Promise.all([
        fetch7TVEmotes(userId),
        fetchBTTVEmotes(userId),
        fetchFFZEmotes(userId)
      ]);
    } catch (error) {
      console.error('Error loading emotes:', error);
    } finally {
      if (requestId === loadRequestId) {
        loadingEmotes = false;
      }
    }
  }

  function replaceEmotes(text) {
    if (!text) return text;

    let replacedText = text;
    // Replace emote names using a split-and-rebuild approach to avoid regex issues
    if (emoteMap7tv.size === 0 && emoteMapBttv.size === 0 && emoteMapFfz.size === 0) return replacedText;

    // Build a Set of emote names for fast lookup

    // Split text into words and non-word separators
    const parts = replacedText.split(/(\s+)/);

    // Replace each part that matches an emote name
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const url7tv = emoteMap7tv.get(part);
      const urlBttv = emoteMapBttv.get(part);
      const urlFfz = emoteMapFfz.get(part);
      const url = url7tv || urlBttv || urlFfz;
      if (url) {
        parts[i] = `<img src="${url}" alt="${part}" class="emote">`;
      }
    }

    replacedText = parts.join('');

    return replacedText;
  }
  function processChatMessage(node) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      const replacedText = replaceEmotes(node.textContent);
      if (replacedText !== node.textContent) {
        const span = document.createElement('span');
        span.innerHTML = replacedText;
        node.replaceWith(span);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      node.childNodes.forEach(processChatMessage);
    }
  }

  function observeChat() {
    const observer = new MutationObserver((mutations) => {
      if (!document.querySelector(CHAT_SELECTOR)) {
        return;
      }
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            node.classList.contains(MESSAGE_SELECTOR)
          ) {
            processChatMessage(node);
          }
        });
      });
    });

    observer.observe(document, { childList: true, subtree: true });
  }

  function init() {
    setInterval(async () => {
      if (!configRead(LOAD_EMOTES)) {
        return;
      }
      if (configRead(USE_EMOTE_PROXY)) {
        EMOTE_PROXY = configRead(EMOTE_PROXY_URL);
      }
      const newUsername = getTwitchUsername(window.location.href);
      if (newUsername && newUsername !== currentChannelLogin) {
        currentChannelLogin = newUsername;
        emoteMap7tv = new Map(); // Reset emote map for the new channel
        emoteMapBttv = new Map();
        emoteMapFfz = new Map();

        if (newUsername == 'search' || !newUsername) {
          return;
        }

        await loadEmotesForChannel(currentChannelLogin);
      }
    }, 1000);

    observeChat();
  }

  init();
})();

/**
 * Force babel to interpret this file as ESM so it
 * polyfills with ESM imports instead of CommonJS.
 */
export { };

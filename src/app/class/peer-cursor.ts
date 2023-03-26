import { ImageFile, ImageState } from './core/file-storage/image-file';
import { ImageStorage } from './core/file-storage/image-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject, ObjectContext } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem, Network } from './core/system';

import * as localForage from 'localforage';

type UserId = string;
type PeerId = string;
type ObjectIdentifier = string;

@SyncObject('PeerCursor')
export class PeerCursor extends GameObject {
  @SyncVar() userId: UserId = '';
  @SyncVar() peerId: PeerId = '';
  @SyncVar() name: string = '';
  @SyncVar() imageIdentifier: string = '';
  @SyncVar() color: string = PeerCursor.CHAT_DEFAULT_COLOR;
  @SyncVar() isGMMode: boolean = false;

  static isGMHold: boolean = false;

  static readonly CHAT_MY_NAME_LOCAL_STORAGE_KEY = 'udonanaumu-chat-my-name-local-storage';
  static readonly CHAT_MY_COLOR_LOCAL_STORAGE_KEY = 'udonanaumu-chat-my-color-local-storage';
  static readonly CHAT_MY_ICON_LOCAL_STORAGE_KEY = 'udonanaumu-chat-my-icon-local-storage';

  static readonly CHAT_DEFAULT_COLOR = '#444444';
  static readonly CHAT_DEFAULT_NAME = 'プレイヤー';
  static readonly CHAT_TRANSPARENT_COLOR = '#ffffff';

  static myCursor: PeerCursor = null;
  private static userIdMap: Map<UserId, ObjectIdentifier> = new Map();
  private static peerIdMap: Map<PeerId, ObjectIdentifier> = new Map();

  get isMine(): boolean { return (PeerCursor.myCursor && PeerCursor.myCursor === this); }
  get image(): ImageFile { return ImageStorage.instance.get(this.imageIdentifier); }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    if (!this.isMine) {
      EventSystem.register(this)
        .on('DISCONNECT_PEER', event => {
          if (event.data.peerId !== this.peerId) return;
          setTimeout(() => {
            if (Network.peerIds.includes(this.peerId)) return;
            PeerCursor.userIdMap.delete(this.userId);
            PeerCursor.peerIdMap.delete(this.peerId);
            ObjectStore.instance.remove(this);
          }, 30000);
        });
    }
  }

  // GameObject Lifecycle
  onStoreRemoved() {
    super.onStoreRemoved();
    EventSystem.unregister(this);
    PeerCursor.userIdMap.delete(this.userId);
    PeerCursor.peerIdMap.delete(this.peerId);
  }

  static findByUserId(userId: UserId): PeerCursor {
    return this.find(PeerCursor.userIdMap, userId, true);
  }

  static findByPeerId(peerId: PeerId): PeerCursor {
    return this.find(PeerCursor.peerIdMap, peerId, false);
  }

  private static find(map: Map<string, string>, key: string, isUserId: boolean): PeerCursor {
    let identifier = map.get(key);
    if (identifier != null && ObjectStore.instance.get(identifier)) return ObjectStore.instance.get<PeerCursor>(identifier);
    let cursors = ObjectStore.instance.getObjects<PeerCursor>(PeerCursor);
    for (let cursor of cursors) {
      let id = isUserId ? cursor.userId : cursor.peerId;
      if (id === key) {
        map.set(id, cursor.identifier);
        return cursor;
      }
    }
    return null;
  }

  static async createMyCursor(): Promise<PeerCursor> {
    if (PeerCursor.myCursor) {
      console.warn('It is already created.');
      return PeerCursor.myCursor;
    }
    PeerCursor.myCursor = new PeerCursor();
    PeerCursor.myCursor.peerId = Network.peerId;
    PeerCursor.myCursor.initialize();
    try {
      // 互換のためしばらく残す ---
      try {
        if (window.localStorage && localStorage.getItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY)) {
          PeerCursor.myCursor.name = localStorage.getItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY);
          await localForage.setItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY, PeerCursor.myCursor.name, () => {
            localStorage.removeItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY);
          });
        }
      } catch(e) {
        console.log(e);
      }
      try {
        if (window.localStorage && localStorage.getItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY)) {
          PeerCursor.myCursor.color = localStorage.getItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY);
          await localForage.setItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY, PeerCursor.myCursor.color, () => {
            localStorage.removeItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY);
          });
        }
      } catch(e) {
        console.log(e);
      }
      // ---
      await localForage.getItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY).then(name => {
        if (typeof name === 'string') {
          PeerCursor.myCursor.name = name;
        } else {
          if (name !== undefined) localForage.removeItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY);
        }
      });
      await localForage.getItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY).then(color => {
        if (typeof color === 'string' && /^\#[0-9a-f]{6}$/.test(color.trim().toLowerCase())) {
          PeerCursor.myCursor.color = color.trim().toLowerCase();
        } else {
          if (color !== undefined) localForage.removeItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY);
        }
      });
      // アイコン
      try { 
        await localForage.getItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY).then(identifierOrImageData => {
          let blob: Blob = null;
          if (typeof identifierOrImageData === 'string') {
            if (identifierOrImageData.startsWith('data:image/')) {
              const type = identifierOrImageData.substring('data:'.length, identifierOrImageData.indexOf(';'));
              const bin = atob(identifierOrImageData.replace(/^.*,/, '')); 
              let buffer = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) {
                buffer[i] = bin.charCodeAt(i);
              }
              blob = new Blob([buffer.buffer], { type: type });
            } else {
              const identifier = ImageStorage.instance.images.find(image => image.identifier === identifierOrImageData);
              if (identifier) {
                PeerCursor.myCursor.imageIdentifier = identifierOrImageData;
              } else {
                localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY);
              }
            }
          } else if (identifierOrImageData instanceof Blob) {
            blob = identifierOrImageData;
          } else {
            localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY);
          }
          if (blob) {
            ImageFile.createAsync(blob).then(imageFile => {
              if (imageFile.state === ImageState.COMPLETE) {
                ImageStorage.instance.add(imageFile);
                PeerCursor.myCursor.imageIdentifier = imageFile.identifier;
              } else {
                localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY);
              }
            });
          }
        }).catch(e => { throw e; });
      } catch (e) {
        console.log(e);
        localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY);
      }
    } catch (e) {
      console.log(e);
      await localForage.removeItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
      await localForage.removeItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    }
    return PeerCursor.myCursor;
  }

  // override
  apply(context: ObjectContext) {
    let userId = context.syncData['userId'];
    let peerId = context.syncData['peerId'];
    if (userId !== this.userId) {
      PeerCursor.userIdMap.set(userId, this.identifier);
      PeerCursor.userIdMap.delete(this.userId);
    }
    if (peerId !== this.peerId) {
      PeerCursor.peerIdMap.set(peerId, this.identifier);
      PeerCursor.peerIdMap.delete(this.peerId);
    }
    super.apply(context);
  }

  isPeerAUdon(): boolean {
    return /u.*d.*o.*n/ig.exec(this.peerId) != null;
  }
}

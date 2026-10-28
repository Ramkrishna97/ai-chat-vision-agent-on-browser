const DB_NAME = 'lite-chat-local-v1';

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('chats', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function operation(mode, callback) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('chats', mode);
    const request = callback(tx.objectStore('chats'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  }));
}

export const listChats = async () => (await operation('readonly', store => store.getAll())).sort((a, b) => b.updatedAt - a.updatedAt);
export const getChat = id => operation('readonly', store => store.get(id));
export const saveChat = chat => operation('readwrite', store => store.put(chat));
export const deleteChat = id => operation('readwrite', store => store.delete(id));

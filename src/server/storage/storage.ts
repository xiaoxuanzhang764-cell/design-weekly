export interface StoredMedia {
  path: string
  url: string
}

export interface MediaStorage {
  put(input: {
    id: string
    bytes: Uint8Array
    extension: string
  }): Promise<StoredMedia>
  delete(path: string): Promise<void>
}

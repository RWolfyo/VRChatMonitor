export interface PlayerJoinEvent {
  userId: string;
  displayName: string;
  timestamp: Date;
}

export interface PlayerLeaveEvent {
  userId: string;
  displayName: string;
  timestamp: Date;
}

export interface BlocklistUpdatedEvent {
  timestamp: Date;
  entriesCount: number;
  keywordsCount: number;
  source: 'local' | 'remote';
}

export interface VersionMismatchEvent {
  currentVersion: string;
  remoteVersion: string;
  message: string;
}

import type { SessionMemoryState } from '@/sync/viewport-store';

export interface TurnHistorySignalsInput {
    memoryState: SessionMemoryState | null;
    loadedMessageCount: number;
    loadedTurnCount: number;
    turnStart: number;
    defaultHistoryLimit: number;
}

export interface TurnHistorySignals {
    hasBufferedTurns: boolean;
    hasMoreAboveTurns: boolean;
    historyLoading: boolean;
    canLoadEarlier: boolean;
}


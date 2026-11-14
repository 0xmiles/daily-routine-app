/**
 * Product switches.
 *
 * assets — 자산 (계좌 통장, 거래내역 올리기, 잔액 평가) is turned off: it is not in
 * the menus, /assets sends you to 오늘, and the weekly 거래내역 reminder is not
 * sent. Its code, API and stored data stay, so turning this back on restores it.
 */
export const FEATURES = {
  assets: false,
} as const;

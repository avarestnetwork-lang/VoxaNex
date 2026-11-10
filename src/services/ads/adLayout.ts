// Minimum usable chatroom dimensions preserved by the current page layout.
export const MIN_CHATROOM_WIDTH = 720;
export const MIN_CHATROOM_HEIGHT = 580;
export const HORIZONTAL_AD_GAP = 12; // Tailwind gap-3
export const VERTICAL_AD_GAP = 10; // Tailwind mb-2.5 / mt-2.5

/**
 * `currentChatWidth` is measured from the actual chatroom element. If the
 * other side is configured but has not filled yet, reserve the same width for
 * it so simultaneous responses cannot both pass against stale measurements.
 */
export function fitsSidePlacement(
  currentChatWidth: number,
  placementWidth: number,
  otherSideAlreadyPresent: boolean,
  otherSideMayFill: boolean,
): boolean {
  const otherWidth = otherSideAlreadyPresent ? 0 : otherSideMayFill ? placementWidth : 0;
  const gaps = otherSideMayFill && !otherSideAlreadyPresent ? HORIZONTAL_AD_GAP * 2 : HORIZONTAL_AD_GAP;
  return currentChatWidth - placementWidth - otherWidth - gaps >= MIN_CHATROOM_WIDTH;
}

/** `currentChatHeight` is measured from the chatroom after any current fills. */
export function fitsVerticalPlacement(
  currentChatHeight: number,
  placementHeight: number,
  otherVerticalAlreadyPresent: boolean,
  otherVerticalMayFill: boolean,
): boolean {
  const otherHeight = otherVerticalAlreadyPresent ? 0 : otherVerticalMayFill ? placementHeight : 0;
  const gaps = otherVerticalMayFill && !otherVerticalAlreadyPresent ? VERTICAL_AD_GAP * 2 : VERTICAL_AD_GAP;
  return currentChatHeight - placementHeight - otherHeight - gaps >= MIN_CHATROOM_HEIGHT;
}

export function hasUsableChatroomSize(width: number, height: number): boolean {
  return width >= MIN_CHATROOM_WIDTH && height >= MIN_CHATROOM_HEIGHT;
}

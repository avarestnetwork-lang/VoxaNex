/**
 * Utilities for formatting dates and times with Asia/Dhaka timezone (BST UTC+6)
 */

export function formatDhakaTime(dateInput?: string | number | Date, locale: 'en' | 'bn' = 'en'): string {
  const date = dateInput ? new Date(dateInput) : new Date();
  
  if (isNaN(date.getTime())) {
    return '--:-- BST';
  }

  try {
    const timeFormatter = new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-US', {
      timeZone: 'Asia/Dhaka',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    const timeString = timeFormatter.format(date);
    return `${timeString} BST`;
  } catch {
    // Fallback if Intl fails
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    const dhakaTime = new Date(utc + (3600000 * 6));
    const hours = dhakaTime.getHours().toString().padStart(2, '0');
    const mins = dhakaTime.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins} BST (UTC+6)`;
  }
}

export function formatDhakaDate(dateInput?: string | number | Date, locale: 'en' | 'bn' = 'en'): string {
  const date = dateInput ? new Date(dateInput) : new Date();

  if (isNaN(date.getTime())) {
    return '---';
  }

  try {
    const dateFormatter = new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-US', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    return dateFormatter.format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

export function toRelativeTime(dateInput: string | number | Date, locale: 'en' | 'bn' = 'en'): string {
  const date = new Date(dateInput);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) {
    return locale === 'bn' ? 'এইমাত্র' : 'Just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return locale === 'bn' ? `${diffMin} মিনিট আগে` : `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return locale === 'bn' ? `${diffHour} ঘণ্টা আগে` : `${diffHour}h ago`;
  }
  const diffDays = Math.floor(diffHour / 24);
  return locale === 'bn' ? `${diffDays} দিন আগে` : `${diffDays}d ago`;
}

import { useDeviceInfo } from '@/lib/device';

/**
 * Convenience hook wrapping useDeviceInfo for responsive layout decisions.
 * Breakpoints: mobile < 768, tablet < 1024, desktop >= 1024.
 */
export function useResponsive() {
  const { isMobile, isTablet, isDesktop } = useDeviceInfo();
  return { isMobile, isTablet, isDesktop };
}

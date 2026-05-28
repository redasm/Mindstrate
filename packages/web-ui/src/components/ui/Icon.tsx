'use client';

import { Icon as IconifyIcon } from '@iconify/react';

type Props = {
  icon: string;
  className?: string;
  width?: number | string;
  height?: number | string;
};

export function Icon({ icon, className, width, height }: Props) {
  return <IconifyIcon icon={icon} className={className} width={width} height={height} />;
}

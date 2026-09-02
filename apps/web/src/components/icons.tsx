import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2 13.5 13.5" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const CaretIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon strokeWidth={2.2} {...p}>
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </Icon>
);

export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 3.5h3.5V7" />
    <path d="M12.5 3.5 7.5 8.5" />
    <path d="M11.5 9.5v3h-8v-8h3" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5 14.5 13.5h-13z" />
    <path d="M8 6.5v3.2" />
    <circle cx="8" cy="11.8" r="0.55" fill="currentColor" stroke="none" />
  </Icon>
);

export const CacheIcon = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="8" cy="4" rx="5" ry="2" />
    <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" />
    <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
  </Icon>
);

export const DocIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 1.5H4.5v13h7V4z" />
    <path d="M9 1.5V4h2.5" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.4 1.6" />
  </Icon>
);

export const SpinnerIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
    <path
      d="M14 8a6 6 0 0 0-6-6"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    />
  </svg>
);

import React, {
  ButtonHTMLAttributes,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ArrowRight, Loader, LucideIcon, Pencil } from 'lucide-react';

const ICON_SIZE = 14;

export const Icon = (props: { icon: LucideIcon; className?: string }) => {
  const { icon: IconComponent, className = '' } = props;
  return (
    <IconComponent
      size={ICON_SIZE}
      strokeWidth={1.75}
      aria-hidden
      className={`shrink-0 ${className}`}
    />
  );
};

export const Spinner = (props: { className?: string }) => (
  <Icon icon={Loader} className={`animate-spin ${props.className || ''}`} />
);

export const Screen = (props: { children: ReactNode }) => (
  <div className="flex flex-col gap-5 px-5 pt-5 pb-4 bg-white">
    {props.children}
  </div>
);

export const Header = (props: { children: ReactNode }) => (
  <div className="flex flex-col gap-2.5">{props.children}</div>
);

export const Eyebrow = (props: { left: ReactNode; right?: ReactNode }) => (
  <div className="flex justify-between items-center gap-3 text-[13px] text-muted whitespace-nowrap">
    <div className="flex items-center gap-1.5 min-w-0">{props.left}</div>
    {props.right && <div className="text-[12px]">{props.right}</div>}
  </div>
);

export const Headline = (props: { children: ReactNode }) => (
  <h1 className="text-[20px] font-normal text-ink">{props.children}</h1>
);

export const Address = (props: {
  children: ReactNode;
  action?: ReactNode;
  muted?: boolean;
  small?: boolean;
}) => (
  <div className="flex justify-between items-center gap-3 min-h-7">
    <div
      className={`font-mono ${
        props.small ? 'text-[18px]' : 'text-[20px]'
      } truncate ${props.muted ? 'text-muted' : 'text-ink'}`}
      title={typeof props.children === 'string' ? props.children : undefined}
    >
      {props.children}
    </div>
    {props.action}
  </div>
);

export const Rule = () => <div className="h-px w-full shrink-0 bg-line" />;

export const Record = (props: { children: ReactNode }) => (
  <div className="flex flex-col w-full">
    <Rule />
    {props.children}
  </div>
);

export const RecordRow = (props: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  muted?: boolean;
  trailing?: ReactNode;
  labelWidth?: 'popup' | 'page';
}) => {
  const { labelWidth = 'popup' } = props;
  return (
    <div className="flex flex-col w-full">
      <div className="flex items-center gap-3 py-3">
        <div
          className={`${
            labelWidth === 'popup' ? 'w-24' : 'w-[120px]'
          } shrink-0 text-[13px] text-muted`}
        >
          {props.label}
        </div>
        <div
          className={`flex-1 min-w-0 text-[14px] break-words ${
            props.mono ? 'font-mono' : ''
          } ${props.muted ? 'text-muted' : 'text-ink'}`}
        >
          {props.children}
        </div>
        {props.trailing}
      </div>
      <Rule />
    </div>
  );
};

export const PageRow = (
  props: Omit<Parameters<typeof RecordRow>[0], 'labelWidth'>
) => <RecordRow labelWidth="page" {...props} />;

export const Section = (props: {
  title: string;
  children: ReactNode;
  hint?: ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <h2 className="text-[13px] text-muted">{props.title}</h2>
    {props.children}
    {props.hint}
  </section>
);

export const EditableRecordRow = (props: {
  label: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(props.value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const commit = () => {
    setIsEditing(false);
    const value = draft.trim();
    if (value !== props.value) {
      props.onCommit(value);
    }
  };

  return (
    <RecordRow
      label={props.label}
      mono={props.mono}
      muted={!props.value}
      trailing={
        !isEditing &&
        !props.disabled && (
          <button
            type="button"
            aria-label={`Edit ${props.label.toLowerCase()}`}
            className="text-faint hover:text-ink rounded-sm"
            onClick={() => {
              setDraft(props.value);
              setIsEditing(true);
            }}
          >
            <Icon icon={Pencil} />
          </button>
        )
      }
    >
      {isEditing ? (
        <input
          ref={inputRef}
          aria-label={props.label}
          value={draft}
          placeholder={props.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
            } else if (e.key === 'Escape') {
              setIsEditing(false);
            }
          }}
          className={`w-full bg-transparent outline-none border-b border-ink text-[14px] ${
            props.mono ? 'font-mono' : ''
          }`}
        />
      ) : (
        <span className="block truncate" title={props.value}>
          {props.value || props.placeholder}
        </span>
      )}
    </RecordRow>
  );
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  icon?: LucideIcon;
};

const buttonBase =
  'w-full h-11 shrink-0 inline-flex justify-center items-center gap-2 rounded-lg text-[15px] font-semibold disabled:cursor-not-allowed';

export const PrimaryButton = (props: ButtonProps) => {
  const { loading, icon, children, className = '', ...rest } = props;
  return (
    <button
      type="button"
      className={`${buttonBase} bg-ink text-white hover:bg-black disabled:bg-wash disabled:text-muted ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Spinner /> : icon && <Icon icon={icon} />}
      {children}
    </button>
  );
};

export const SecondaryButton = (props: ButtonProps) => {
  const { loading, icon, children, className = '', ...rest } = props;
  return (
    <button
      type="button"
      className={`${buttonBase} border border-line text-ink hover:bg-wash ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Spinner /> : icon && <Icon icon={icon} />}
      {children}
    </button>
  );
};

export const IconButton = (
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: LucideIcon;
    spin?: boolean;
    'aria-label': string;
  }
) => {
  const { icon, spin, className = '', ...rest } = props;
  return (
    <button
      type="button"
      title={rest['aria-label']}
      className={`size-7 shrink-0 inline-flex justify-center items-center border border-line rounded text-ink hover:bg-wash disabled:text-faint disabled:cursor-not-allowed ${className}`}
      {...rest}
    >
      <Icon icon={icon} className={spin ? 'animate-spin' : ''} />
    </button>
  );
};

const textActionClassName =
  'inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink whitespace-nowrap';

export const TextButton = (
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: LucideIcon;
    arrow?: boolean;
  }
) => {
  const { icon, arrow, children, className = '', ...rest } = props;
  return (
    <button
      type="button"
      className={`${textActionClassName} ${className}`}
      {...rest}
    >
      {icon && <Icon icon={icon} />}
      {children}
      {arrow && <Icon icon={ArrowRight} />}
    </button>
  );
};

export const TextLink = (
  props: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    icon?: LucideIcon;
    arrow?: boolean;
  }
) => {
  // https://github.com/jsx-eslint/eslint-plugin-react/issues/3284
  // eslint-disable-next-line react/prop-types
  const { icon, arrow, children, className = '', ...rest } = props;
  return (
    <a
      target="_blank"
      rel="noreferrer"
      className={`${textActionClassName} ${className}`}
      {...rest}
    >
      {icon && <Icon icon={icon} />}
      {children}
      {arrow && <Icon icon={ArrowRight} />}
    </a>
  );
};

export const Actions = (props: { children: ReactNode }) => (
  <div className="flex flex-col items-start gap-3.5 w-full">
    {props.children}
  </div>
);

export const Footer = (props: { left: ReactNode; right: ReactNode }) => (
  <>
    <Rule />
    <div className="flex justify-between items-center">
      {props.left}
      {props.right}
    </div>
  </>
);

export const ListRow = (props: {
  title: ReactNode;
  meta: ReactNode;
  muted?: boolean;
  onClick: () => void;
}) => (
  <div className="flex flex-col w-full">
    <button
      type="button"
      onClick={props.onClick}
      className="group flex items-center gap-3 py-[11px] w-full text-left"
    >
      <div className="flex flex-col gap-[3px] flex-1 min-w-0">
        <div
          className={`font-mono text-[14px] truncate group-hover:underline ${
            props.muted ? 'text-muted' : 'text-ink'
          }`}
        >
          {props.title}
        </div>
        <div className="text-[12px] text-muted truncate">{props.meta}</div>
      </div>
      <Icon icon={ArrowRight} className="text-faint group-hover:text-ink" />
    </button>
    <Rule />
  </div>
);

export const Hint = (props: { children: ReactNode }) => (
  <p className="text-[12px] text-muted">{props.children}</p>
);

export const Toggle = (props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  'aria-label': string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={props.checked}
    aria-label={props['aria-label']}
    onClick={() => props.onChange(!props.checked)}
    className={`relative w-8 h-[18px] shrink-0 rounded-full border-[1.5px] border-ink transition-colors ${
      props.checked ? 'bg-ink' : 'bg-white'
    }`}
  >
    <span
      className={`absolute top-[1.5px] size-3 rounded-full transition-all ${
        props.checked ? 'left-[15px] bg-white' : 'left-[1.5px] bg-ink'
      }`}
    />
  </button>
);

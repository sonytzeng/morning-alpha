type VisualSectionHeaderProps = {
  icon: string;
  title: string;
  description?: string;
};

export default function VisualSectionHeader({ icon, title, description }: VisualSectionHeaderProps) {
  return (
    <header className="ma-section-header">
      <span className="ma-section-icon" aria-hidden="true">
        <i className={icon} />
      </span>
      <div>
        <h2 className="ma-h2">{title}</h2>
        {description && <p className="ma-body mt-1">{description}</p>}
      </div>
    </header>
  );
}

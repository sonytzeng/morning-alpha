import { Link } from 'react-router-dom';

type VisualPageHeroProps = {
  eyebrow: string;
  icon: string;
  title: string;
  subtitle: string;
  decisionLabel: string;
  decision: string;
  ctaLabel: string;
  ctaTo: string;
};

export default function VisualPageHero({
  eyebrow,
  icon,
  title,
  subtitle,
  decisionLabel,
  decision,
  ctaLabel,
  ctaTo,
}: VisualPageHeroProps) {
  return (
    <section className="ma-page-hero">
      <div className="ma-section-inner">
        <div className="ma-page-hero-grid">
          <div className="min-w-0">
            <p className="ma-eyebrow flex items-center gap-2"><i className={icon} aria-hidden="true" />{eyebrow}</p>
            <h1 className="ma-h1 mt-3">{title}</h1>
            <p className="ma-body mt-3 max-w-2xl">{subtitle}</p>
          </div>
          <div className="ma-card-primary ma-page-hero-decision">
            <div>
              <p className="ma-caption">{decisionLabel}</p>
              <p className="ma-h3 mt-2">{decision}</p>
            </div>
            <Link to={ctaTo} className="ma-btn-primary w-full sm:w-auto">
              {ctaLabel}
              <i className="ri-arrow-right-line" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

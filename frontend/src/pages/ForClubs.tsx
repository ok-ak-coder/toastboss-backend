import { Link } from 'react-router-dom';

const ForClubsPage = () => {
  return (
    <section className="toastboss-panel toastboss-for-clubs-page">
      <div className="toastboss-section-copy">
        <span className="toastboss-kicker">For club leaders</span>
        <h2>ToastBoss helps club admins stop juggling scheduling by hand</h2>
        <p>ToastBoss gives your club one place to manage roster emails, member availability, assignment fairness, and schedule decisions without the usual spreadsheet chase.</p>
      </div>

      <div className="toastboss-story-grid">
        <article className="toastboss-story-card">
          <h3>The problems it solves</h3>
          <p>Most clubs lose time every week chasing members, fixing last-minute conflicts, and trying to keep roles fair without overloading the same reliable people.</p>
        </article>

        <article className="toastboss-story-card">
          <h3>How it works</h3>
          <p>Your admin sets up the club, uploads the roster, and uses ToastBoss to organize who is available, who has served recently, and who is best suited for each role.</p>
        </article>

        <article className="toastboss-story-card">
          <h3>Why clubs like it</h3>
          <p>Members get clarity, leaders get less admin drag, and the club gets a more balanced schedule that feels thoughtful instead of improvised.</p>
        </article>
      </div>

      <div className="toastboss-benefit-block">
        <h3>What ToastBoss is built to improve</h3>
        <p>It reduces repetitive scheduling work, makes fairness easier to track, cuts down on role confusion, and gives your club admin a cleaner way to onboard and manage the club.</p>
      </div>

      <div className="toastboss-benefit-block">
        <h3>What happens next</h3>
        <p>Once your club is set up, the admin account becomes the starting point for roster management, future availability collection, and schedule generation.</p>
      </div>

      <div className="toastboss-cta-row">
        <Link className="toastboss-secondary-cta" to="/setup-club">
          Create a club account
        </Link>
        <Link className="toastboss-text-link" to="/login">
          Back to member sign in
        </Link>
      </div>
    </section>
  );
};

export default ForClubsPage;

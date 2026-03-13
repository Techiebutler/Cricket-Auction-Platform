"""
AWS SES email service.
All send_* functions are fire-and-forget — they log errors but never raise,
so email failures never break the main request flow.
"""
import logging
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_client():
    return boto3.client(
        "ses",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_MAIL_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_MAIL_SECRET_ACCESS_KEY,
    )


def _send(to: str, subject: str, html: str, text: str = "") -> bool:
    """Core send function. Returns True on success."""
    if not settings.email_enabled:
        logger.info("[EMAIL DISABLED] Would send '%s' to %s", subject, to)
        return False
    try:
        client = _get_client()
        client.send_email(
            Source=settings.EMAIL_FROM,
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Html": {"Data": html, "Charset": "UTF-8"},
                    "Text": {"Data": text or subject, "Charset": "UTF-8"},
                },
            },
        )
        logger.info("[EMAIL] Sent '%s' to %s", subject, to)
        return True
    except (BotoCoreError, ClientError) as e:
        logger.error("[EMAIL ERROR] %s", e)
        return False


# ─── HTML template helper ────────────────────────────────────────────────────

def _base_template(title: str, body_html: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;color:#f1f1f1;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:16px;overflow:hidden;border:1px solid #1f2937;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#b45309,#f59e0b);padding:28px 40px;text-align:center;">
            <div style="font-size:32px;margin-bottom:8px;">🏏</div>
            <h1 style="margin:0;font-size:22px;color:#000;font-weight:800;letter-spacing:-0.5px;">Cricket Auction</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            {body_html}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1f2937;text-align:center;">
            <p style="margin:0;font-size:12px;color:#4b5563;">
              Powered by Techiebutler · Cricket Auction Platform
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def _h2(text: str) -> str:
    return f'<h2 style="margin:0 0 12px;font-size:20px;color:#f9fafb;">{text}</h2>'


def _p(text: str) -> str:
    return f'<p style="margin:0 0 16px;font-size:15px;color:#9ca3af;line-height:1.6;">{text}</p>'


def _btn(text: str, url: str) -> str:
    return f"""
<div style="text-align:center;margin:24px 0;">
  <a href="{url}" style="display:inline-block;background:#f59e0b;color:#000;font-weight:700;
     font-size:15px;padding:12px 32px;border-radius:8px;text-decoration:none;">{text}</a>
</div>"""


def _stat_row(items: list[tuple[str, str]]) -> str:
    cells = "".join(
        f'<td style="text-align:center;padding:12px 20px;">'
        f'<div style="font-size:22px;font-weight:800;color:#f59e0b;">{v}</div>'
        f'<div style="font-size:11px;color:#6b7280;margin-top:2px;">{k}</div>'
        f'</td>'
        for k, v in items
    )
    return f'<table width="100%" cellpadding="0" cellspacing="0" style="background:#1f2937;border-radius:10px;margin:20px 0;"><tr>{cells}</tr></table>'


# ─── Public send functions ────────────────────────────────────────────────────

def send_welcome(to: str, name: str) -> None:
    """Sent when a new player registers."""
    html = _base_template(
        "Welcome to Cricket Auction",
        _h2(f"Welcome, {name}! 🎉")
        + _p("You've successfully joined the Cricket Auction platform. Complete your player profile to get ready for the next auction.")
        + _btn("Complete Your Profile", f"{settings.SITE_URL}/onboarding")
        + _p("Once an organizer adds you to an event, you'll receive another email with the details.")
    )
    _send(to, "Welcome to Cricket Auction 🏏", html)


def send_event_invitation(
    to: str,
    name: str,
    event_name: str,
    event_id: int,
    role: str,
) -> None:
    """Sent when an organizer adds a player / assigns a captain or auctioneer."""
    role_label = role.capitalize()
    role_desc = {
        "player": "You've been added to the player pool and will be up for auction.",
        "captain": "You've been assigned as team captain. You'll bid for players during the live auction.",
        "auctioneer": "You've been assigned as the auctioneer. You'll control the auction flow on the day.",
        "organizer": "You've been assigned as the event organizer.",
    }.get(role, "You have a role in this event.")

    html = _base_template(
        f"You're invited: {event_name}",
        _h2(f"You're in, {name}!")
        + _p(f"You've been added to <strong style='color:#f9fafb;'>{event_name}</strong> as <strong style='color:#f59e0b;'>{role_label}</strong>.")
        + _p(role_desc)
        + _btn("View Event", f"{settings.SITE_URL}/dashboard")
        + _p("Make sure your profile is complete before auction day. Good luck! 🏏"),
    )
    _send(to, f"You're invited to {event_name} as {role_label} 🏏", html)


def send_auction_starting(
    to: str,
    name: str,
    event_name: str,
    event_id: int,
    role: str,
) -> None:
    """Broadcast when auctioneer hits Start."""
    route_map = {
        "auctioneer": f"{settings.SITE_URL}/auction/{event_id}/auctioneer",
        "captain": f"{settings.SITE_URL}/auction/{event_id}/captain",
    }
    url = route_map.get(role, f"{settings.SITE_URL}/auction/{event_id}/spectate")
    btn_label = {
        "auctioneer": "Open Control Panel",
        "captain": "Enter Bid Room",
    }.get(role, "Watch Live")

    html = _base_template(
        f"{event_name} — Auction Started!",
        _h2("🔴 The Auction is LIVE!")
        + _p(f"Hey {name}, the auction for <strong style='color:#f9fafb;'>{event_name}</strong> has just started.")
        + _btn(btn_label, url)
        + _p("Don't miss a bid — join now before it's too late!"),
    )
    _send(to, f"🔴 {event_name} auction is LIVE now!", html)


def send_player_sold(
    to: str,
    captain_name: str,
    player_name: str,
    team_name: str,
    sold_price: int,
    event_id: int,
) -> None:
    """Sent to the captain when they win a player."""
    html = _base_template(
        f"You won {player_name}!",
        _h2(f"Sold! 🔨 You won {player_name}")
        + _stat_row([("Player", player_name), ("Price", str(sold_price)), ("Team", team_name)])
        + _p(f"Congratulations {captain_name}! <strong style='color:#f9fafb;'>{player_name}</strong> is now part of your squad for <strong>{sold_price}</strong> credits.")
        + _btn("View My Team", f"{settings.SITE_URL}/auction/{event_id}/captain"),
    )
    _send(to, f"You won {player_name} for {sold_price}! 🏏", html)


def send_magic_code(to: str, name: str, code: str) -> None:
    """One-time 6-digit login code email."""
    # Render each digit as its own table cell — prevents any line-wrap in email clients
    digit_cells = "".join(
        f"""<td style="padding:0 4px;">
              <div style="width:44px;height:56px;background:#1f2937;border:2px solid #374151;
                          border-radius:10px;text-align:center;line-height:56px;
                          font-size:32px;font-weight:900;color:#f59e0b;font-family:monospace;">
                {d}
              </div>
            </td>"""
        for d in code
    )

    html = _base_template(
        "Your login code",
        _h2(f"Hi {name}, here's your login code")
        + f"""
<div style="text-align:center;margin:28px 0;">
  <table cellpadding="0" cellspacing="0" style="display:inline-table;margin:0 auto;">
    <tr>{digit_cells}</tr>
  </table>
  <p style="color:#6b7280;font-size:12px;margin-top:16px;letter-spacing:0.3px;">
    Expires in <strong style="color:#9ca3af;">10 minutes</strong> &nbsp;·&nbsp; One-time use only
  </p>
</div>
"""
        + _p("Enter this code on the login page to sign in to your Cricket Auction account.")
        + _p("<small style='color:#6b7280;'>If you didn't request this, you can safely ignore this email.</small>"),
    )
    _send(to, "Your Cricket Auction login code", html)


def send_organizer_invite(to: str, event_name: str, token: str, role: str) -> None:
    """Sent to someone who doesn't have an account yet — invite to join as organizer/auctioneer."""
    role_label = role.capitalize()
    accept_url = f"{settings.SITE_URL}/accept-invite?token={token}"
    html = _base_template(
        f"You're invited to {event_name}",
        _h2(f"You've been invited! 🎉")
        + _p(f"You've been invited to join <strong style='color:#f9fafb;'>{event_name}</strong> as <strong style='color:#f59e0b;'>{role_label}</strong>.")
        + _p("Click the button below to create your account and get started. This invite link expires in 7 days.")
        + _btn(f"Accept Invite & Register", accept_url)
        + _p(f"<small style='color:#6b7280;'>If you weren't expecting this, you can safely ignore it.</small>"),
    )
    _send(to, f"You're invited to {event_name} as {role_label} 🏏", html)


def send_auction_summary(
    to: str,
    name: str,
    event_name: str,
    team_name: Optional[str],
    players_won: list[dict],
    budget_spent: int,
    budget_remaining: int,
) -> None:
    """End-of-auction summary sent to captains."""
    player_rows = "".join(
        f'<tr>'
        f'<td style="padding:8px 12px;color:#f9fafb;font-size:14px;">{p["name"]}</td>'
        f'<td style="padding:8px 12px;color:#f59e0b;font-size:14px;text-align:right;">{p["price"]}</td>'
        f'</tr>'
        for p in players_won
    )
    roster_table = f"""
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1f2937;border-radius:10px;margin:16px 0;overflow:hidden;">
  <tr style="background:#374151;">
    <th style="padding:10px 12px;text-align:left;font-size:12px;color:#9ca3af;text-transform:uppercase;">Player</th>
    <th style="padding:10px 12px;text-align:right;font-size:12px;color:#9ca3af;text-transform:uppercase;">Price</th>
  </tr>
  {player_rows if player_rows else '<tr><td colspan="2" style="padding:12px;text-align:center;color:#6b7280;">No players won</td></tr>'}
</table>"""

    html = _base_template(
        f"{event_name} — Auction Complete",
        _h2(f"Auction Over! Here's your summary 📋")
        + (f'<p style="margin:0 0 16px;font-size:15px;color:#9ca3af;">Team: <strong style="color:#f9fafb;">{team_name}</strong></p>' if team_name else "")
        + _stat_row([("Players Won", str(len(players_won))), ("Spent", str(budget_spent)), ("Remaining", str(budget_remaining))])
        + roster_table
        + _p(f"Thanks for participating in <strong style='color:#f9fafb;'>{event_name}</strong>. See you on the pitch!"),
    )
    _send(to, f"{event_name} auction complete — your squad summary 🏏", html)


def send_event_completion_summary(
    to: str,
    name: str,
    event_name: str,
    event_id: int,
    summary: dict,
) -> None:
    """Event-wide completion summary sent to all participants."""
    highest = summary.get("highest_bid_player") or {}
    strongest = summary.get("strongest_team") or {}
    teams = summary.get("teams") or []
    unsold = summary.get("unsold_players") or []
    stats = summary.get("stats") or {}

    highest_html = (
        f'<p style="margin:0;font-size:14px;color:#d1d5db;">'
        f'<strong style="color:#f9fafb;">{highest.get("player_name", "-")}</strong> · '
        f'₹{highest.get("sold_price", 0)} · '
        f'<span style="color:#86efac;">{highest.get("team_name", "-")}</span>'
        f"</p>"
        if highest
        else '<p style="margin:0;font-size:14px;color:#6b7280;">No sold players.</p>'
    )

    strongest_html = (
        f'<p style="margin:0;font-size:14px;color:#d1d5db;">'
        f'<strong style="color:#f9fafb;">{strongest.get("team_name", "-")}</strong> · '
        f'Overall avg {strongest.get("overall_rating", 0)} '
        f'(Bat {strongest.get("batting_avg", 0)}, Bowl {strongest.get("bowling_avg", 0)}, Field {strongest.get("fielding_avg", 0)})'
        f"</p>"
        if strongest
        else '<p style="margin:0;font-size:14px;color:#6b7280;">No teams available.</p>'
    )

    team_blocks = ""
    for t in teams:
        players = t.get("players", [])
        top_players = players[:8]
        rows = "".join(
            f'<tr>'
            f'<td style="padding:6px 10px;color:#e5e7eb;font-size:12px;">{p.get("name")}</td>'
            f'<td style="padding:6px 10px;color:#f59e0b;font-size:12px;text-align:right;">₹{p.get("sold_price")}</td>'
            f"</tr>"
            for p in top_players
        )
        if not rows:
            rows = '<tr><td colspan="2" style="padding:8px 10px;color:#6b7280;font-size:12px;">No players</td></tr>'
        overflow_note = (
            f'<p style="margin:6px 0 0;color:#6b7280;font-size:11px;">+{len(players)-8} more players</p>'
            if len(players) > 8
            else ""
        )
        team_blocks += (
            f'<div style="background:#1f2937;border:1px solid #374151;border-radius:10px;padding:10px;margin:10px 0;">'
            f'<p style="margin:0 0 6px;font-size:14px;color:#f9fafb;font-weight:700;">{t.get("team_name")}</p>'
            f'<p style="margin:0 0 8px;font-size:12px;color:#9ca3af;">Players: {t.get("player_count")} · Spent: {t.get("spent")} · Left: {t.get("remaining")}</p>'
            f'<table width="100%" cellpadding="0" cellspacing="0">{rows}</table>'
            f"{overflow_note}"
            f"</div>"
        )

    unsold_rows = "".join(
        f'<tr>'
        f'<td style="padding:6px 10px;color:#e5e7eb;font-size:12px;">{p.get("name")}</td>'
        f'<td style="padding:6px 10px;color:#9ca3af;font-size:12px;text-align:right;">Base ₹{p.get("base_price")}</td>'
        f"</tr>"
        for p in unsold[:15]
    )
    if not unsold_rows:
        unsold_rows = '<tr><td colspan="2" style="padding:8px 10px;color:#6b7280;font-size:12px;">No unsold players</td></tr>'
    unsold_more = (
        f'<p style="margin:6px 0 0;color:#6b7280;font-size:11px;">+{len(unsold)-15} more unsold players</p>'
        if len(unsold) > 15
        else ""
    )

    body = (
        _h2(f"Auction completed: {event_name} ✅")
        + _p(f"Hi {name}, here is the final event summary.")
        + _stat_row(
            [
                ("Total Players", str(stats.get("total_players", 0))),
                ("Sold", str(stats.get("sold_count", 0))),
                ("Unsold", str(stats.get("unsold_count", 0))),
            ]
        )
        + '<div style="background:#1f2937;border-radius:10px;padding:12px;margin:14px 0;">'
        + '<p style="margin:0 0 6px;color:#9ca3af;font-size:12px;text-transform:uppercase;">Highest Bid Player</p>'
        + highest_html
        + "</div>"
        + '<div style="background:#1f2937;border-radius:10px;padding:12px;margin:14px 0;">'
        + '<p style="margin:0 0 6px;color:#9ca3af;font-size:12px;text-transform:uppercase;">Most Powerful Team (ratings)</p>'
        + strongest_html
        + "</div>"
        + '<h3 style="margin:18px 0 8px;color:#f3f4f6;font-size:15px;">Teams and Players</h3>'
        + team_blocks
        + '<h3 style="margin:18px 0 8px;color:#f3f4f6;font-size:15px;">Unsold Players</h3>'
        + '<div style="background:#1f2937;border:1px solid #374151;border-radius:10px;padding:8px;">'
        + f'<table width="100%" cellpadding="0" cellspacing="0">{unsold_rows}</table>'
        + unsold_more
        + "</div>"
        + _btn("View Auction", f"{settings.SITE_URL}/auction/{event_id}/spectate")
    )

    html = _base_template(f"{event_name} — Completed Summary", body)
    _send(to, f"{event_name} completed — full auction summary", html)

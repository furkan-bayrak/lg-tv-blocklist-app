/*
 * src/domains.gen.ts -- GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Generator: tools/gen-domains.mjs
 * Regenerate from the COMMITTED files alone (no network, no upstream checkout):
 *
 *     node tools/gen-domains.mjs --emit-ts
 *
 * The full regeneration (node tools/gen-domains.mjs, which needs the pinned
 * lg-tv-blocklist checkout) writes app/filter/domains.json first and emits this
 * module from it, so both paths produce the same bytes for the same data.
 *
 * The TV webview cannot read files at runtime and the fixed bridge command set
 * has no read command, so the row metadata has to be compiled in. The single
 * source of truth stays app/filter/domains.json; this is that file in the shape
 * the UI consumes. rows is domains.json file order (category, then name) with
 * anchor true iff the row is a zone anchor (tier === zone, zone === name).
 * presetEntries is each tier preset ENTRY COUNT, counted from the shipped
 * preset lists with list_entry_count()'s rule (app/scripts/common.sh), i.e.
 * what check.sh reports as entries=<N> for that tier with no overrides.
 *
 * ES5: plain object literal, no Map/Set, no getters, no template literals, so
 * tools/check-es5.mjs and tools/check-node8.mjs stay green on the compiled file.
 */

interface LgDomainRow {
  name: string;
  tier: 'safe' | 'strict' | 'zone';
  category: string;
  zone: string;
  anchor: boolean;
  note: string;
}

interface LgDomainsModule {
  schema: number;
  count: number;
  anchors: number;
  presetEntries: { safe: number; strict: number };
  rows: LgDomainRow[];
}

var LgDomains: LgDomainsModule = {
  schema: 1,
  count: 115,
  anchors: 8,
  presetEntries: { safe: 20, strict: 123 },
  rows: [
    { name: "aic.cdpbeacon.lgtvcommon.com", tier: "strict", category: "acr", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 telemetry/ACR beacon (~6-min heartbeat) \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12; bare cdpbeacon.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "cdpbeacon.lgtvcommon.com", tier: "safe", category: "acr", zone: "lgtvcommon.com", anchor: false, note: "telemetry/ACR beacon (6-min heartbeat pattern observed) | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH (A/AAAA/CNAME). Service moved to the eic./aic./kic. cluster names, which are DNS-verified only and therefore filed in src/strict.txt tagged weak \u2014 the SAFE tier no longer covers this service. Kept for the audit record." },
    { name: "eic.cdpbeacon.lgtvcommon.com", tier: "strict", category: "acr", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 telemetry/ACR beacon (~6-min heartbeat) \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12; bare cdpbeacon.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "kic.cdpbeacon.lgtvcommon.com", tier: "strict", category: "acr", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 telemetry/ACR beacon (~6-min heartbeat) \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12; bare cdpbeacon.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "ad.lgappstv.com", tier: "safe", category: "ads", zone: "", anchor: false, note: "ad delivery on the lgappstv store CDN family (store unaffected) | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "ads.lgtvcommon.com", tier: "safe", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "ad delivery (querylog family) | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH (A/AAAA/CNAME). Service moved to the eic./aic./kic. cluster names, which are DNS-verified only and therefore filed in src/strict.txt tagged weak \u2014 the SAFE tier no longer covers this service. Kept for the audit record." },
    { name: "adsdtvc.com", tier: "safe", category: "ads", zone: "", anchor: false, note: "ad zone | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "aic.ads.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 ad delivery \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12; bare ads.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "aic.homeprv.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 home-screen provisioning/promos \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12; bare homeprv.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "aic.nudge.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 nudge/notification telemetry \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.recommend.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 recommendations/promos \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12; bare recommend.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "de.info.lgsmartad.com", tier: "safe", category: "ads", zone: "", anchor: false, note: "ad info endpoint [REGION-SCOPED]" },
    { name: "eic.ads.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 ad delivery \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12; bare ads.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "eic.homeprv.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 home-screen provisioning/promos \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12; bare homeprv.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "eic.nudge.lgtvcommon.com", tier: "safe", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "nudge/notification telemetry" },
    { name: "eic.recommend.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 recommendations/promos \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12; bare recommend.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "homeprv.lgtvcommon.com", tier: "safe", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "home-screen provisioning/promos | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH (A/AAAA/CNAME). Service moved to the eic./aic./kic. cluster names, which are DNS-verified only and therefore filed in src/strict.txt tagged weak \u2014 the SAFE tier no longer covers this service. Kept for the audit record." },
    { name: "info.lgsmartad.com", tier: "safe", category: "ads", zone: "", anchor: false, note: "ad info endpoint (admanager poll ~60s); community report: Level1Techs \"LG TV Block Mini-How-to\" #255178 (wendell, 2026-09-05; observed live on G5); not observed on G1 | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "kic.ads.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 ad delivery \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12; bare ads.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "kic.homeprv.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 home-screen provisioning/promos \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12; bare homeprv.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "kic.nudge.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 nudge/notification telemetry \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic.recommend.lgtvcommon.com", tier: "strict", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 recommendations/promos \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12; bare recommend.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "lgsmartad.com", tier: "safe", category: "ads", zone: "", anchor: false, note: "dedicated ad zone apex (whole family is ads)" },
    { name: "recommend.lgtvcommon.com", tier: "safe", category: "ads", zone: "lgtvcommon.com", anchor: false, note: "recommendations/promos | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH (A/AAAA/CNAME). Service moved to the eic./aic./kic. cluster names, which are DNS-verified only and therefore filed in src/strict.txt tagged weak \u2014 the SAFE tier no longer covers this service. Kept for the audit record." },
    { name: "smart.adtvc.app", tier: "safe", category: "ads", zone: "", anchor: false, note: "ad serving (adtvc.app family) | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "bss.lgechannel.com", tier: "strict", category: "channels", zone: "", anchor: false, note: "LG Channels (FAST) backend \u2014 feature kill by design | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "lgechannel.com", tier: "strict", category: "channels", zone: "", anchor: false, note: "LG Channels apex \u2014 feature kill by design | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "discovery.meethue.com", tier: "strict", category: "interop", zone: "", anchor: false, note: "interop: Philips Hue cloud bridge discovery (N-UPnP), called by LG TV background discovery; reported on webOS 25 (repo issue #12, @rugk); observed on G1 (webOS 6) 2026-06-11..2026-09-14 (pcap frame 25919: TLS SNI to 34.117.13.189:443; AGH ~4,100 lookups, ~5-min cadence); cloud discovery only, local mDNS unaffected; breakage unverified (no Hue bridge)" },
    { name: "ueiwsp.com", tier: "strict", category: "interop", zone: "", anchor: false, note: "weak \u2014 interop: QuickSet Cloud (UEI) discovery API; community report 2026-09-11 (repo issue #3 querylog; device unstated; not observed on G1; www subdomain observed live on G1 2026-09-12); breakage untested" },
    { name: "www.ueiwsp.com", tier: "strict", category: "interop", zone: "", anchor: false, note: "interop: QuickSet Cloud (UEI) discovery API; community report 2026-09-11 (repo issue #3 querylog); observed on G1 2026-09-12 (11 queries / 48 min; AGH querylog via Fritz relay); breakage untested" },
    { name: "aic-gfts.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "file transfer service \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic-ngfts.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "firmware/content file transfer \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic-ngfts.nextlgsdp.com", tier: "strict", category: "ota", zone: "nextlgsdp.com", anchor: false, note: "update transfer on SDP family \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic-ngfts.tv.wiselg.com", tier: "strict", category: "ota", zone: "wiselg.com", anchor: false, note: "update transfer (wiselg family) \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "eic-gfts.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "file-transfer telemetry" },
    { name: "eic-ngfts.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "update-check/file-transfer telemetry (boot burst)" },
    { name: "eic-ngfts.nextlgsdp.com", tier: "strict", category: "ota", zone: "nextlgsdp.com", anchor: false, note: "update transfer on SDP family \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "eic-ngfts.tv.wiselg.com", tier: "strict", category: "ota", zone: "wiselg.com", anchor: false, note: "update transfer (wiselg family)" },
    { name: "gfts.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "file transfer service" },
    { name: "kic-gfts.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "file transfer service \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic-ngfts.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "firmware/content file transfer \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic-ngfts.nextlgsdp.com", tier: "strict", category: "ota", zone: "nextlgsdp.com", anchor: false, note: "update transfer on SDP family \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic-ngfts.tv.wiselg.com", tier: "strict", category: "ota", zone: "wiselg.com", anchor: false, note: "update transfer (wiselg family) \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "ngfts.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "firmware/content file transfer" },
    { name: "ngfts.nextlgsdp.com", tier: "strict", category: "ota", zone: "nextlgsdp.com", anchor: false, note: "update transfer on SDP family" },
    { name: "snu.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "firmware OTA check server" },
    { name: "su-dev.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "OTA update server (dev channel)" },
    { name: "su-ssl.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "OTA update server (SSL)" },
    { name: "su.lge.com", tier: "strict", category: "ota", zone: "lge.com", anchor: false, note: "OTA update server" },
    { name: "aic-ocp.lgtviot.com", tier: "strict", category: "other", zone: "lgtviot.com", anchor: false, note: "weak \u2014 unknown (DNS only) \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.cdplauncher.lgtvcommon.com", tier: "strict", category: "other", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 content-launcher/CDP service \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.lgchhomeapp.lgtvcommon.com", tier: "strict", category: "other", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 home-app service \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "am.lge.com", tier: "strict", category: "other", zone: "lge.com", anchor: false, note: "weak \u2014 observed, function unproven" },
    { name: "eic-ocp.lgtviot.com", tier: "strict", category: "other", zone: "lgtviot.com", anchor: false, note: "weak \u2014 unknown (DNS only; unrelated to the local panel-compensation daemon)" },
    { name: "eic.cdplauncher.lgtvcommon.com", tier: "strict", category: "other", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 content-launcher/CDP service" },
    { name: "eic.lgchhomeapp.lgtvcommon.com", tier: "strict", category: "other", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 home-app service" },
    { name: "fms.lgunifiedsmart.com", tier: "strict", category: "other", zone: "", anchor: false, note: "weak \u2014 smart-family messaging service | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "ig.lge.com", tier: "strict", category: "other", zone: "lge.com", anchor: false, note: "weak \u2014 observed, function unproven | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "kic-ocp.lgtviot.com", tier: "strict", category: "other", zone: "lgtviot.com", anchor: false, note: "weak \u2014 unknown (DNS only) \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic.cdplauncher.lgtvcommon.com", tier: "strict", category: "other", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 content-launcher/CDP service \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic.lgchhomeapp.lgtvcommon.com", tier: "strict", category: "other", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 home-app service \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "lgtvonline.lge.com", tier: "strict", category: "other", zone: "lge.com", anchor: false, note: "weak \u2014 post-boot only, function unproven" },
    { name: "lgunifiedsmart.com", tier: "strict", category: "other", zone: "", anchor: false, note: "smart-family umbrella | ZONE RETIRED 2026-09-12: the apex itself is NXDOMAIN on Google+Cloudflare DoH, so the whole zone is gone (fms.lgunifiedsmart.com with it). Kept as an anchor in case LG revives it; costs nothing while the zone does not exist." },
    { name: "rdx2.lgtvsdp.com", tier: "strict", category: "other", zone: "", anchor: false, note: "weak \u2014 unknown" },
    { name: "a.lgappstv.com", tier: "strict", category: "store", zone: "", anchor: false, note: "weak \u2014 store-CDN-adjacent, app-update function unproven | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "aic.lgeapi.com", tier: "strict", category: "store", zone: "lgeapi.com", anchor: false, note: "weak \u2014 region API, store/billing interplay unproven \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.lggalleryplus.com", tier: "strict", category: "store", zone: "", anchor: false, note: "weak \u2014 Gallery+/SDX endpoint \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.lgshopsvc.lgappstv.com", tier: "strict", category: "store", zone: "", anchor: false, note: "weak \u2014 LG Shop service (SDX) \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.service.lgtvcommon.com", tier: "strict", category: "store", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 common-services endpoint, store interplay unproven \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12; bare service.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "de.ibs.nextlgsdp.com", tier: "strict", category: "store", zone: "nextlgsdp.com", anchor: false, note: "weak \u2014 possible in-app billing path (store risk)" },
    { name: "de.lgeapi.com", tier: "strict", category: "store", zone: "lgeapi.com", anchor: false, note: "weak \u2014 region API, store/billing interplay unproven" },
    { name: "eic.lgeapi.com", tier: "strict", category: "store", zone: "lgeapi.com", anchor: false, note: "weak \u2014 region API, store/billing interplay unproven \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "eic.lggalleryplus.com", tier: "strict", category: "store", zone: "", anchor: false, note: "weak \u2014 Gallery+/SDX endpoint \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "eic.lgshopsvc.lgappstv.com", tier: "strict", category: "store", zone: "", anchor: false, note: "weak \u2014 LG Shop service (SDX) \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "eic.service.lgtvcommon.com", tier: "strict", category: "store", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 common-services endpoint, store interplay unproven \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12; bare service.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "kic.lgeapi.com", tier: "strict", category: "store", zone: "lgeapi.com", anchor: false, note: "weak \u2014 region API, store/billing interplay unproven \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic.lggalleryplus.com", tier: "strict", category: "store", zone: "", anchor: false, note: "weak \u2014 Gallery+/SDX endpoint \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic.service.lgtvcommon.com", tier: "strict", category: "store", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 common-services endpoint, store interplay unproven \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12; bare service.lgtvcommon.com is now NXDOMAIN, so this is where the service lives" },
    { name: "lgappstv.com", tier: "strict", category: "store", zone: "", anchor: false, note: "weak \u2014 store CDN apex (blocking apex = exact-name only in hosts/domains)" },
    { name: "lggalleryplus.com", tier: "strict", category: "store", zone: "", anchor: false, note: "weak \u2014 Gallery+/SDX endpoint; community report: Level1Techs \"LG TV Block Mini-How-to\" #255178 (wendell, 2026-09-05; G5 recon 2026-08-24); not observed on G1" },
    { name: "lgshopsvc.lgappstv.com", tier: "strict", category: "store", zone: "", anchor: false, note: "weak \u2014 LG Shop service (SDX); community report: Level1Techs \"LG TV Block Mini-How-to\" #255178 (wendell, 2026-09-05; observed live on G5); not observed on G1" },
    { name: "service.lgtvcommon.com", tier: "strict", category: "store", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 common-services endpoint, store interplay unproven | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH (A/AAAA/CNAME). Service moved to the eic./aic./kic. cluster names added below \u2014 those are the live ones now. Kept for the audit record." },
    { name: "aic.api.lgtviot.com", tier: "strict", category: "telemetry", zone: "lgtviot.com", anchor: false, note: "weak \u2014 IoT telemetry API \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.lgtviot.com", tier: "strict", category: "telemetry", zone: "lgtviot.com", anchor: false, note: "weak \u2014 IoT telemetry (largest observed family) \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.tv.wiselg.com", tier: "strict", category: "telemetry", zone: "wiselg.com", anchor: false, note: "weak \u2014 TV telemetry \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.wiseconfig.lgtvcommon.com", tier: "strict", category: "telemetry", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 cloud-config telemetry \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "ca.nextlgsdp.com", tier: "safe", category: "telemetry", zone: "nextlgsdp.com", anchor: false, note: "SDP Canada region endpoint, telemetry \u2014 observed live on LG C1 (Canada), ~1/min after power-on + playback; querylog.json attached to PR #9" },
    { name: "de.emp.lgsmartplatform.com", tier: "safe", category: "telemetry", zone: "lgsmartplatform.com", anchor: false, note: "smart-platform telemetry [REGION-SCOPED]" },
    { name: "de.nextlgsdp.com", tier: "safe", category: "telemetry", zone: "nextlgsdp.com", anchor: false, note: "SDP region endpoint, telemetry [REGION-SCOPED]" },
    { name: "eic.api.lgtviot.com", tier: "safe", category: "telemetry", zone: "lgtviot.com", anchor: false, note: "IoT telemetry API" },
    { name: "eic.lgtviot.com", tier: "safe", category: "telemetry", zone: "lgtviot.com", anchor: false, note: "IoT telemetry (largest observed family, ~5.1k queries)" },
    { name: "eic.tv.wiselg.com", tier: "safe", category: "telemetry", zone: "wiselg.com", anchor: false, note: "TV telemetry (blocked live, apps fine)" },
    { name: "eic.wiseconfig.lgtvcommon.com", tier: "safe", category: "telemetry", zone: "lgtvcommon.com", anchor: false, note: "cloud-config telemetry (blocked live, apps fine)" },
    { name: "initscr.lge.com", tier: "safe", category: "telemetry", zone: "lge.com", anchor: false, note: "initial-setup telemetry (boot-time only) | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "kic.api.lgtviot.com", tier: "strict", category: "telemetry", zone: "lgtviot.com", anchor: false, note: "weak \u2014 IoT telemetry API \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic.lgtviot.com", tier: "strict", category: "telemetry", zone: "lgtviot.com", anchor: false, note: "weak \u2014 IoT telemetry (largest observed family) \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic.tv.wiselg.com", tier: "strict", category: "telemetry", zone: "wiselg.com", anchor: false, note: "weak \u2014 TV telemetry \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic.wiseconfig.lgtvcommon.com", tier: "strict", category: "telemetry", zone: "lgtvcommon.com", anchor: false, note: "weak \u2014 cloud-config telemetry \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "lgtvsdp.com", tier: "safe", category: "telemetry", zone: "", anchor: false, note: "SDP telemetry apex (service delivery platform beacons)" },
    { name: "aic-op-lss.lgthinq.com", tier: "strict", category: "thinq", zone: "lgthinq.com", anchor: false, note: "ThinQ operations telemetry \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "aic.lgthinq.com", tier: "strict", category: "thinq", zone: "lgthinq.com", anchor: false, note: "weak \u2014 ThinQ cloud entry point \u2014 aic (Americas) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "eic-op-lss.lgthinq.com", tier: "strict", category: "thinq", zone: "lgthinq.com", anchor: false, note: "ThinQ operations telemetry" },
    { name: "eic.lgthinq.com", tier: "strict", category: "thinq", zone: "lgthinq.com", anchor: false, note: "weak \u2014 ThinQ cloud entry point \u2014 eic (Europe) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic-op-lss.lgthinq.com", tier: "strict", category: "thinq", zone: "lgthinq.com", anchor: false, note: "ThinQ operations telemetry \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "kic.lgthinq.com", tier: "strict", category: "thinq", zone: "lgthinq.com", anchor: false, note: "weak \u2014 ThinQ cloud entry point \u2014 kic (Korea) datacentre cluster; DNS-verified 2026-09-12" },
    { name: "lss.lgthinq.com", tier: "strict", category: "thinq", zone: "lgthinq.com", anchor: false, note: "ThinQ cloud sync backend" },
    { name: "lgsmartweb.com", tier: "strict", category: "voice", zone: "", anchor: false, note: "weak \u2014 voice search backend; blocking breaks remote voice search; community report: Level1Techs \"LG TV Block Mini-How-to\" #255178 (wendell, 2026-09-05; G5 recon 2026-08-24); not observed on G1 | DECOMMISSIONED 2026-09-12: NXDOMAIN on Google+Cloudflare DoH. No cluster successor found. Kept for the audit record; harmless to block." },
    { name: "lge.com", tier: "zone", category: "zone", zone: "lge.com", anchor: true, note: "umbrella zone \u2014 kills all lge.com subdomains in adblock format (blocked as a whole zone under STRICT; under SAFE this row blocks only lge.com)" },
    { name: "lgeapi.com", tier: "zone", category: "zone", zone: "lgeapi.com", anchor: true, note: "region API umbrella (blocked as a whole zone under STRICT; under SAFE this row blocks only lgeapi.com)" },
    { name: "lgsmartplatform.com", tier: "zone", category: "zone", zone: "lgsmartplatform.com", anchor: true, note: "smart-platform telemetry umbrella \u2014 de.emp.lgsmartplatform.com observed; regional siblings otherwise uncovered (blocked as a whole zone under STRICT; under SAFE this row blocks only lgsmartplatform.com)" },
    { name: "lgthinq.com", tier: "zone", category: "zone", zone: "lgthinq.com", anchor: true, note: "ThinQ umbrella (blocked as a whole zone under STRICT; under SAFE this row blocks only lgthinq.com)" },
    { name: "lgtvcommon.com", tier: "zone", category: "zone", zone: "lgtvcommon.com", anchor: true, note: "common-services telemetry umbrella \u2014 live-blocked on G1 AGH since 2026-09-09 (no breakage); hagezi umbrella 2026-09; wildcard-safe per Level1Techs \"LG TV Block Mini-How-to\" #255178 (wendell, 2026-09-05) (blocked as a whole zone under STRICT; under SAFE this row blocks only lgtvcommon.com)" },
    { name: "lgtviot.com", tier: "zone", category: "zone", zone: "lgtviot.com", anchor: true, note: "IoT umbrella (blocked as a whole zone under STRICT; under SAFE this row blocks only lgtviot.com)" },
    { name: "nextlgsdp.com", tier: "zone", category: "zone", zone: "nextlgsdp.com", anchor: true, note: "SDP umbrella (blocked as a whole zone under STRICT; under SAFE this row blocks only nextlgsdp.com)" },
    { name: "wiselg.com", tier: "zone", category: "zone", zone: "wiselg.com", anchor: true, note: "TV/wiselg telemetry umbrella (blocked as a whole zone under STRICT; under SAFE this row blocks only wiselg.com)" }
  ]
};

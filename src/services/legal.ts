import type { Locale } from "../i18n/config";
export type LegalDocument = {
  title: string;
  /**
   * ISO date the owner approves for publication (YYYY-MM-DD). Unset until that
   * decision; the page shows the line only once it is set (launch checklist).
   */
  effectiveDate?: string;
  paragraphs: readonly string[];
  sections?: readonly {
    heading: string;
    paragraphs: readonly string[];
    links?: readonly { label: string; href: string }[];
  }[];
};

export const legalDocuments = {
  privacy: {
    en: {
      title: "Privacy policy",
      paragraphs: [
        "You can plan a trip without an account. We use the details you enter to estimate costs. Your search travels with the page link, so anyone you share it with can see your choices.",
      ],
      sections: [
        {
          heading: "What happens to a search?",
          paragraphs: [
            "The planner uses your departure city, travel month, budget, the amount you plan to spend on food and the room standard you choose. These choices can stay in your browser history until you clear it. Clearing history does not remove copies of a link you have shared. We do not keep a named trip history or ask for passenger names, passports or payment details.",
            "Your search is not sent to any travel provider. The fares shown come from prices we collect on a schedule from the Aviasales data service for our departure cities. Those requests contain no visitor information.",
          ],
        },
        {
          heading: "Cookies and booking links",
          paragraphs: [
            "The planner does not set cookies or save preferences on your device. Your choices stay in the search link.",
            "If you open a flight link, we send the airports, dates, passenger counts and our referral identifiers to Travelpayouts to create an Aviasales link. A successful link can be reused for 24 hours. You then leave Trip Range. The partner can use its own cookies or identifiers to credit a booking to us. Its privacy notice and terms apply there.",
            "If you open a room search, your browser goes straight to Booking.com with the city, dates and number of guests in the link. It does not pass through our servers and carries no referral identifier from us. Booking.com’s privacy notice and terms apply there.",
          ],
        },
        {
          heading: "What we measure",
          paragraphs: [
            "We count how often a click on a flight button produces a partner link and how often it does not. We group these counts by UTC day, airport pair and fare age. The counters hold no visitor ID, individual click time or record of your journey.",
            "On a quiet route, someone who already knows a visit occurred could link it to a count of one. We keep the counters internal. If we share figures outside Trip Range, we combine or withhold groups with fewer than five observations.",
          ],
        },
        {
          heading: "How long do we keep information?",
          paragraphs: [
            "Netlify hosts Trip Range and may process IP addresses to deliver and protect the site. Its request records show the requested URL, including any search details in the query string, the time, response status, duration and user-agent category. Netlify sets the window we can see in its Observability dashboard. On our Free plan we can see the past 24 hours. We have not verified when Netlify deletes all underlying copies. We have never enabled Netlify Web Analytics and have no log drains configured to forward these records.",
            "We use Upstash Redis in Frankfurt to limit excessive requests. We set each shared counter to expire 60 seconds after its window starts. These shared counters count requests by operation and contain no visitor identifier. Daily backups are off, and our account check found no backups. We could not establish how long Upstash keeps its infrastructure logs.",
            "To stop excessive requests, we turn your IP address into a short code using a secret key that changes every day. We count requests against that code for 60 seconds and then discard it. We do not store your IP address.",
            "Our Neon Postgres database is in Frankfurt. Our routine clean-up removes raw fare replies older than 2 days and fare observations and their fetch records older than 10 days. These records describe routes, dates and prices. We do not attach them to a visitor account or IP address. We keep aggregate booking-button counts indefinitely as statistics. They contain no visitor identifier and no timestamp more precise than a UTC day.",
            "We use Neon’s default Free-plan recovery setting. Neon limits how far we can restore earlier database versions to six hours or 1 GB of data changes, whichever limit is reached first. This window applies to past versions, including recently deleted records. Current records follow the retention rules above.",
            "Our contact address is hello@trip-range.com. Correspondence includes your email address and what you send us. We keep it for 12 months and then delete it. Deleted mail stays in our email provider’s trash for 30 days. We keep no separate copies or backups of our own. We have not verified every country in which our providers process data.",
          ],
          links: [
            {
              label: "Netlify request history",
              href: "https://docs.netlify.com/manage/monitoring/observability/overview/",
            },
            {
              label: "Neon database history",
              href: "https://neon.com/docs/postgres/backup-restore/history-window",
            },
            {
              label: "Neon Free plan limits",
              href: "https://neon.com/pricing",
            },
          ],
        },
        {
          heading: "Why we use personal data",
          paragraphs: [
            "Under Kosovo’s Law No. 06/L-082, we use the trip details needed to fulfil our agreement to provide the searches and partner links you request. Our legitimate interests are keeping the planner secure, fixing faults, answering enquiries and understanding how the links that fund the service are used. You can object to processing based on those interests. We also use the information needed to meet our legal duties, including handling a privacy request.",
          ],
        },
        {
          heading: "Your rights and how to use them",
          paragraphs: [
            "Email hello@trip-range.com or write to the address below. Tell us what you would like us to find or change. If you contacted us by email, the address you used will help us find the message. We may ask for enough information to check your identity. For a search without an account, we may have no way to identify a record as yours.",
            "You can ask for access to your personal data, a correction, deletion or a restriction on its use. Where the law allows, you can ask for a portable copy or object to processing. If you have given consent, you can withdraw it for future use.",
            "We will respond within one month. If the complexity or number of requests requires more time, we will explain why within that first month. The law allows up to two further months. You can also complain directly to Kosovo’s Information and Privacy Agency.",
          ],
          links: [
            {
              label: "Read Kosovo’s Law on Protection of Personal Data",
              href: "https://gzk.rks-gov.net/ActDetail.aspx?ActID=18616&langid=2",
            },
            {
              label: "Make a complaint to the Information and Privacy Agency",
              href: "https://aip.rks-gov.net/complaints/?aip_lang=en",
            },
          ],
        },
      ],
    },
    sq: {
      title: "Privatësia",
      paragraphs: [
        "GoEksplo përdor vendet, datat dhe preferencat që dërgon për të përgatitur vlerësime udhëtimi. Zgjedhjet shfaqen në adresën e faqes dhe mund të mbeten në historikun e shfletuesit ose në lidhjet e shpërndara. Mos përfshi të dhëna personale ose të ndjeshme.",
        "Kërkimi mund të dërgojë itinerare te Travelpayouts dhe emra destinacionesh te Wikimedia Commons ose Pexels. Kur përdor shprehimisht kërkimin me AI, përshkrimi i dërgohet OpenAI për interpretim. GoEksplo nuk ruan përshkrimet e papërpunuara të AI në memorien e përkohshme ose regjistrat operacionalë të aplikacionit. Përpunimi dhe ruajtja nga ofruesit ndjekin politikat e tyre.",
        "Vercel ofron hostimin dhe analitikën. Analitika e aplikacionit heq parametrat e kërkimit dhe mban pak ngjarje, si përdorimi i AI dhe klikimet te partnerët. Regjistrat operacionalë përmbajnë emrin e ofruesit, kategorinë e gabimit dhe kohëzgjatjen. Numëruesit e kërkesave nuk ruajnë përshkrime ose identitete. Infrastruktura e hostimit mund të përpunojë të dhëna rrjeti për funksionimin dhe sigurinë.",
        "Faqet e rezervimit kanë politikat e tyre të privatësisë. GoEksplo V1 nuk mbledh pagesa dhe nuk ofron llogari përdoruesi.",
        "TODO para publikimit: përcakto operatorin dhe kontaktin e privatësisë; konfirmo të drejtat përkatëse, afatet e ruajtjes dhe procesin e kërkesave të privatësisë. Kërkohet shqyrtim nga operatori dhe juristi.",
      ],
    },
  },
  terms: {
    en: {
      title: "Terms of use",
      paragraphs: [
        "Trip Range helps you decide whether a trip might fit your budget. We do not sell travel, take bookings or payments, or issue tickets.",
      ],
      sections: [
        {
          heading: "What a price means",
          paragraphs: [
            "Our figures are planning estimates. A recorded fare shows what the source reported for a route and dates. For local costs, check what was observed, when it was checked and which items still lack a price. An unpriced item can still cost you money. A budget reserve is money set aside for unexpected costs.",
            "We cannot guarantee that a fare, room or other service will be available, or that you can buy it for the amount shown. Check the dates, passenger count, baggage, taxes and final total with the seller before you pay.",
          ],
        },
        {
          heading: "Who handles your booking?",
          paragraphs: [
            "A flight or room link takes you to a partner site. If you book, your contract is with the seller named at checkout and its terms apply. Contact that seller about a payment, change, cancellation or refund. If something on Trip Range looks wrong, contact us using the details below.",
          ],
        },
        {
          heading: "Our responsibility",
          paragraphs: [
            "We are responsible for the planning service we provide. To the extent the law allows, we are not liable for a price change, cancellation or failure to provide travel caused by the seller and outside our control. This does not limit any responsibility we have for our own errors or any right you cannot give up by law.",
            "Kosovo law governs these terms. You keep any mandatory consumer protections in your country of residence.",
          ],
        },
        {
          heading: "Complaints and who can use Trip Range",
          paragraphs: [
            "Send any complaint about Trip Range to hello@trip-range.com. A complaint about a booking, payment or refund goes to the seller named at checkout.",
            "Trip Range is not directed at children under 16.",
          ],
        },
      ],
    },
    sq: {
      title: "Kushtet",
      paragraphs: [
        "GoEksplo është mjet planifikimi udhëtimesh. Buxheti bashkon tarifa të fundit fluturimi, kur gjenden, me vlerësime planifikimi. Një tarifë e fundit nuk është inventar në kohë reale dhe nuk garanton çmim ose disponueshmëri.",
        "Akomodimi, bagazhi, ushqimi, transporti lokal, aktivitetet dhe transferet për aeroportet afër janë vlerësime. Fondi rezervë nuk është shpenzim i pritshëm. Kontrollo datat, udhëtarët, rregullat e bagazhit, transferet dhe kushtet e hyrjes para rezervimit.",
        "Rezervimi bëhet në faqen e ofruesit sipas kushteve të tij. Ofruesi konfirmon çmimin dhe disponueshmërinë përfundimtare. GoEksplo nuk merr pagesa dhe nuk lëshon bileta.",
        "Kërkimi global nuk garanton mbulim fluturimesh për çdo itinerar. Destinacionet dinamike kanë informacion të kufizuar lokal. AI ndihmon interpretimin e kërkesës dhe shpjegimin e vlerësimeve; nuk verifikon fakte udhëtimi dhe nuk rezervon.",
        "TODO para publikimit: konfirmo operatorin, kontaktin, kushtet e zbatueshme dhe të drejtat e konsumatorit me shqyrtim ligjor. Këto kushte V1 janë draft dhe nuk përjashtojnë të drejtat e detyrueshme.",
      ],
    },
  },
  "affiliate-disclosure": {
    en: {
      title: "Affiliate disclosure",
      paragraphs: [
        "Trip Range may earn a commission if you follow a flight link and make a qualifying booking. There is no extra charge to you for using the link.",
      ],
      sections: [
        {
          heading: "What happens when you click",
          paragraphs: [
            "Our flight buttons open an Aviasales search through the Travelpayouts affiliate network. The link includes your airports, dates and passenger counts, along with identifiers that credit Trip Range for the referral. The network or partner may use cookies or other identifiers for this purpose.",
            "The seller at checkout sets the price and booking conditions. Trip Range takes no booking or payment. A commission link does not guarantee the fare shown in the planner.",
          ],
          links: [
            {
              label: "How Trip Range measures booking links",
              href: "/privacy",
            },
            {
              label: "Read the terms of use",
              href: "/terms",
            },
          ],
        },
      ],
    },
    sq: {
      title: "Lidhjet me partnerët",
      paragraphs: [
        "GoEksplo mund të marrë komision kur rezervon përmes lidhjeve të partnerëve, pa kosto shtesë për ty.",
        "Butonat e fluturimit përdorin lidhje partnere të Aviasales përmes Travelpayouts. Rezervimi bëhet në faqen e ofruesit, ku konfirmohen çmimi, kushtet dhe disponueshmëria. Tarifat e fundit në GoEksplo mund të ndryshojnë ose të mos jenë më të disponueshme.",
        "Akomodimi mbetet vlerësim i GoEksplo. Aktualisht nuk ofrojmë lidhje rezervimi ose inventar hotelesh. Lidhjet partnere nuk e kthejnë një vlerësim në çmim të konfirmuar.",
      ],
    },
  },
} satisfies Record<string, Record<Locale, LegalDocument>>;

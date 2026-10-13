"""Synthetic in-domain text pairs for the Pure Press stance / claim-matching model.

Every pair is (premise, hypothesis) -> entailment | neutral | contradiction, where the
hypothesis is a neutral English claim as the reading step writes it, and the premise is
what the pipeline compares it with: a news headline (with the " - Publisher" tail that
Google News adds), a fact-check headline, or an encyclopedia sentence.

The set targets the failure modes measured in this project:
  figure            changed figure ("84" vs "85" medals, Rs 5 crore vs Rs 50 crore)
  date              changed year / day / month
  reversed_outcome  won/lost, upheld/set aside, succeeded/failed, raised/cut, accepted/declined
  reversed_roles    "X beat Y" vs "Y beat X", acquirer/target, appointer/appointee
  debunk            "Video of X dancing is AI-generated" vs "A video shows X dancing"
  same_entity       same person or organisation, a different event -> neutral
  sibling_event     same subject and verb, a different named event or place (the Dharapuram bypoll vs the
                    Madurantakam bypoll, the Olympics vs the Chess Olympiad) -> neutral
  swapped_actor     one seat, one winner: another party named as the winner -> contradiction (TVK vs DMK)
  number_format     5.5% = 5.50 per cent, Rs 2,000 = 2000 rupees, Rs 5 lakh = Rs 5,00,000; other figures contradict
  paraphrase        passive voice, synonyms, number words, units, abbreviations -> entailment
  unsupported       the claim adds a detail the premise does not give -> neutral
  encyclopedic      reference-entry sentences that confirm, do not address, or conflict
  multilingual      Hindi and Tamil headlines against English or same-language claims

Splitting is by claim: entities (people, teams, places, ...) are partitioned so that test
claims use entities that never occur in training, and some sentence frames are held out of
training altogether ("unseen frame" test). Names of private persons are fictional.
"""
import argparse
import json
import random

ENT, NEU, CON = 0, 1, 2

# ---------------------------------------------------------------- entity pools
FIRST_M = ["Rajesh", "Suresh", "Karthik", "Arjun", "Vikram", "Manoj", "Sanjay", "Harish", "Ashok", "Ravi",
           "Imran", "Gurpreet", "Joseph", "Biswajit", "Mohan", "Naveen", "Prakash", "Dinesh", "Faisal", "Anand"]
FIRST_F = ["Anita", "Meena", "Priya", "Lakshmi", "Deepa", "Kavitha", "Revathi", "Nirmala", "Sunita", "Pooja",
           "Farida", "Harpreet", "Mary", "Latha", "Shalini", "Geetha", "Radhika", "Swathi", "Nasreen", "Usha"]
SURNAMES = ["Menon", "Iyer", "Deshmukh", "Reddy", "Naidu", "Banerjee", "Chatterjee", "Kulkarni", "Nair", "Pillai",
            "Shetty", "Gupta", "Sharma", "Verma", "Khan", "Siddiqui", "Singh", "Gill", "Thomas", "D'Souza",
            "Mukherjee", "Rao", "Patil", "Joshi", "Bose", "Das", "Krishnan", "Subramanian", "Ahmed", "Sinha"]


def build_people():
    rng = random.Random(7)
    people = []
    for g, firsts in (("m", FIRST_M), ("f", FIRST_F)):
        for f in firsts:
            for s in rng.sample(SURNAMES, 8):
                people.append((f"{f} {s}", g))
    rng.shuffle(people)
    return people


PEOPLE = build_people()  # (name, gender)
PROFS = ["actor", "politician", "cricketer", "jurist", "scientist", "writer", "singer", "film director",
         "economist", "journalist", "footballer", "social worker"]
OFFICES = ["Chief Minister", "Health Minister", "Finance Minister", "Education Minister", "Mayor",
           "Director General of Police", "Chief Secretary", "Vice-Chancellor", "chairman of the board",
           "Transport Minister", "Home Secretary", "Chief Justice"]
TEAMS = ["India", "Australia", "England", "Pakistan", "Sri Lanka", "New Zealand", "South Africa", "West Indies",
         "Bangladesh", "Afghanistan", "Ireland", "Netherlands", "Nepal", "Japan", "Argentina", "Germany", "Spain",
         "Brazil", "France", "Malaysia", "Oman", "Kenya", "Namibia", "Scotland", "Zimbabwe"]
EVENTS = ["Asian Games", "Commonwealth Games", "National Games", "South Asian Games", "Para Asian Games",
          "Youth Olympics", "University Games", "Junior World Championships", "Asian Championships", "Indoor Games"]
TOURNEYS = ["World Cup", "Champions Trophy", "Asia Cup", "Nehru Cup", "Challenger Trophy", "Ranji Trophy",
            "Santosh Trophy", "Duleep Trophy", "Hockey World Cup", "Davis Cup"]
MATCHES = ["second T20I in Ranchi", "first Test in Chennai", "final in Mumbai", "semi-final in Dubai",
           "opening ODI in Pune", "third T20I in Kolkata", "quarter-final in Lahore", "series decider in Nagpur",
           "group match in Bengaluru", "Super Four game in Abu Dhabi", "second ODI in Kanpur", "fifth Test in Delhi",
           "league match in Jaipur", "final in Colombo", "play-off in Hyderabad", "third ODI in Visakhapatnam"]
INCIDENTS = ["building collapse", "bus accident", "crowd crush", "stampede", "train derailment", "boat capsize",
             "factory fire", "landslide", "flash flood", "hospital fire", "bridge collapse", "firecracker blast"]
PLACES = ["Chennai", "Madurai", "Coimbatore", "Delhi", "Mumbai", "Pune", "Kolkata", "Bengaluru", "Hyderabad",
          "Lucknow", "Patna", "Jaipur", "Bhopal", "Kochi", "Guwahati", "Nagpur", "Surat", "Ranchi", "Indore",
          "Visakhapatnam", "Salem", "Tiruchirappalli", "Chandigarh", "Dehradun", "Raipur", "Ahmedabad",
          "Amritsar", "Varanasi", "Mysuru", "Thanjavur"]
STATE_CAPITALS = {
    "Tamil Nadu": "Chennai", "Kerala": "Thiruvananthapuram", "Karnataka": "Bengaluru", "Maharashtra": "Mumbai",
    "Gujarat": "Gandhinagar", "West Bengal": "Kolkata", "Bihar": "Patna", "Uttar Pradesh": "Lucknow",
    "Rajasthan": "Jaipur", "Odisha": "Bhubaneswar", "Assam": "Dispur", "Telangana": "Hyderabad",
    "Andhra Pradesh": "Amaravati", "Madhya Pradesh": "Bhopal", "Jharkhand": "Ranchi", "Chhattisgarh": "Raipur",
    "Goa": "Panaji", "Uttarakhand": "Dehradun", "Himachal Pradesh": "Shimla", "Sikkim": "Gangtok",
    "Manipur": "Imphal", "Meghalaya": "Shillong", "Tripura": "Agartala", "Nagaland": "Kohima",
    "Mizoram": "Aizawl", "Arunachal Pradesh": "Itanagar"}
STATES = list(STATE_CAPITALS)
PARTIES = ["TVK", "DMK", "AIADMK", "BJP", "Congress", "AAP", "TMC", "JD(U)", "BJD", "BRS", "Shiv Sena", "NCP",
           "CPI(M)", "Samajwadi Party", "BSP"]
COURTS = ["Madras High Court", "Delhi High Court", "Kerala High Court", "Bombay High Court", "Karnataka High Court",
          "Supreme Court", "Calcutta High Court", "Allahabad High Court", "Patna High Court", "Gujarat High Court"]
AGENCIES = ["ISRO", "DRDO", "NASA", "ESA", "JAXA", "CSIR", "Indian Railways", "AIIMS", "NHAI", "BSNL"]
MISSIONS = ["EOS-05 satellite launch", "Gaganyaan G1 flight", "lunar sample mission", "Aditya solar probe", "NISAR launch",
            "GSLV-F17 mission", "hypersonic missile test", "Vande Bharat trial run", "metro tunnel boring", "deep-sea probe"]
BILLS = ["Digital Privacy Bill", "Water Resources Amendment Bill", "Women's Reservation Amendment Bill",
         "Insolvency Reform Bill", "Seeds Bill", "Cooperative Societies Bill", "Mining Reforms Bill",
         "Education Funding Bill", "Fisheries Regulation Bill", "Cyber Security Bill"]
SCHEMES = ["free bus travel scheme", "breakfast scheme", "farm loan waiver", "housing scheme", "scholarship scheme",
           "smart classroom programme", "free electricity scheme", "pension scheme", "women's savings scheme",
           "tele-medicine programme", "digital library mission", "solar rooftop scheme"]
THINGS_BAN = ["single-use plastic", "online betting apps", "fireworks in the city", "loudspeakers after 10 pm",
              "plastic carry bags", "energy drinks for minors", "drone flights over the stadium", "foreign liquor sales",
              "two-wheeler taxis", "chinese loan apps", "unregistered coaching centres", "bike stunts on the highway"]
DRUGS = ["dengue vaccine", "malaria drug", "oral insulin", "cancer therapy", "nasal flu vaccine", "TB drug",
         "diabetes tablet", "gene therapy", "cough syrup", "HPV vaccine"]
COMPANIES = ["Zenith Motors", "BlueOrbit Telecom", "Kaveri Foods", "Orion Pharma", "Sundaram Steel", "Vega Retail",
             "NovaGrid Energy", "Tamarind Airlines", "Lotus Bank", "Banyan Software", "Indus Cement", "Meridian Logistics"]
PUBLISHERS = ["The Hindu", "NDTV", "Times of India", "Hindustan Times", "The Indian Express", "India Today",
              "Deccan Herald", "News18", "The New Indian Express", "Dinamani", "ThePrint", "Scroll.in", "Mint"]
AWARDS = ["Padma Shri", "National Film Award", "Sahitya Akademi Award", "Arjuna Award", "Dadasaheb Phalke Award",
          "Jnanpith Award", "Bharat Ratna", "Kalidas Samman", "Gandhi Peace Prize", "Tagore Award"]
THEMES = {  # claim predicates, grouped by theme so that two of one subject never paraphrase each other
    "money": ["took Rs 5 crore to visit the ashram", "received Rs 20 lakh from a private firm", "donated Rs 1 crore to flood relief",
              "bought a farmhouse worth Rs 12 crore", "declared assets of Rs 8 crore", "paid Rs 40 lakh in income tax"],
    "travel": ["visited a temple in Madurai", "travelled to Singapore for a conference", "flew to Delhi for a meeting",
               "inaugurated a bridge in Salem", "toured the flood-hit districts", "attended a wedding in Kochi"],
    "speech": ["urged students to learn a third language", "criticised the fuel price hike", "called for a ban on plastic",
               "said the monsoon session would be short", "promised free laptops for all graduates", "asked farmers to adopt drip irrigation"],
    "office": ["resigned from the party", "was appointed chairman of the state planning board", "took charge as the new vice-chancellor",
               "filed nomination for the by-election", "was removed from the committee", "was sworn in as a member of the council"],
    "health": ["was admitted to a hospital in Chennai", "was discharged after surgery", "tested positive for dengue",
               "started a hunger strike", "completed a marathon in Mumbai", "launched a free health camp"],
    "law": ["was granted bail by the sessions court", "appeared before the enforcement directorate", "filed a defamation case against a magazine",
            "was acquitted in the land case", "was summoned by the parliamentary committee", "withdrew the petition in the High Court"],
    "culture": ["won a state award for literature", "released a new book on Tamil poetry", "inaugurated a film festival in Goa",
                "announced a documentary on river Cauvery", "composed the anthem for the games", "opened an art gallery in Kolkata"],
}
THEME_NAMES = list(THEMES)
ACTIVITIES = ["dancing at a wedding", "addressing a rally", "speaking at the summit", "boarding a flight", "cutting a ribbon",
              "singing on stage", "arguing with a policeman", "praying at a temple", "playing cricket on a beach",
              "touching the feet of a seer", "distributing cash in a village", "fleeing from a crowd"]
CLAIM_WORDS = ["Viral claim", "Claim", "Social media post", "WhatsApp forward", "Viral message"]

HI_TEAMS = {"India": "भारत", "Australia": "ऑस्ट्रेलिया", "England": "इंग्लैंड", "Pakistan": "पाकिस्तान", "Sri Lanka": "श्रीलंका",
            "New Zealand": "न्यूज़ीलैंड", "South Africa": "दक्षिण अफ्रीका", "West Indies": "वेस्टइंडीज", "Bangladesh": "बांग्लादेश",
            "Afghanistan": "अफ़ग़ानिस्तान"}
TA_TEAMS = {"India": "இந்தியா", "Australia": "ஆஸ்திரேலியா", "England": "இங்கிலாந்து", "Pakistan": "பாகிஸ்தான்",
            "Sri Lanka": "இலங்கை", "New Zealand": "நியூசிலாந்து", "South Africa": "தென் ஆப்பிரிக்கா",
            "West Indies": "மேற்கிந்தியத் தீவுகள்", "Bangladesh": "வங்கதேசம்", "Afghanistan": "ஆப்கானிஸ்தான்"}
HI_PLACES = {"Chennai": "चेन्नई", "Delhi": "दिल्ली", "Mumbai": "मुंबई", "Kolkata": "कोलकाता", "Bengaluru": "बेंगलुरु",
             "Hyderabad": "हैदराबाद", "Ranchi": "रांची", "Patna": "पटना", "Lucknow": "लखनऊ", "Madurai": "मदुरै"}
TA_PLACES = {"Chennai": "சென்னையில்", "Delhi": "டெல்லியில்", "Mumbai": "மும்பையில்", "Kolkata": "கொல்கத்தாவில்",
             "Bengaluru": "பெங்களூருவில்", "Hyderabad": "ஹைதராபாத்தில்", "Ranchi": "ராஞ்சியில்", "Patna": "பாட்னாவில்",
             "Lucknow": "லக்னோவில்", "Madurai": "மதுரையில்"}

ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = {20: "twenty", 30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def words(n):
    if n < 20:
        return ONES[n]
    if n < 100 and n % 10 == 0:
        return TENS[n]
    if n < 100:
        return f"{TENS[n - n % 10]}-{ONES[n % 10]}"
    return str(n)


def part(items, split):
    """Test entities never appear in training: every fifth item is reserved for the test split."""
    return [x for i, x in enumerate(items) if (i % 5 == 4) == (split == "test")]


class Ctx:
    def __init__(self, rng, split):
        self.rng, self.split = rng, split
        self._cache = {}

    def pick(self, name, items):
        key = (name, id(items))
        if key not in self._cache:
            self._cache[key] = part(items, self.split)
        return self.rng.choice(self._cache[key])

    def distinct(self, name, items, k):
        key = (name, id(items))
        if key not in self._cache:
            self._cache[key] = part(items, self.split)
        return self.rng.sample(self._cache[key], k)

    def person(self):
        return self.pick("people", PEOPLE)

    def other_num(self, n, lo=1):
        r = self.rng
        for _ in range(20):
            kind = r.random()
            if kind < 0.5:
                m = n + r.choice([-1, 1]) * r.randint(1, max(1, min(5, n // 4 or 1)))
            elif kind < 0.8:
                m = n + r.choice([-1, 1]) * r.randint(1, max(2, n // 2))
            else:
                m = n * r.choice([2, 5, 10]) if r.random() < .6 else max(lo, n // r.choice([2, 5, 10]))
            if m != n and m >= lo:
                return m
        return n + 1

    def other_year(self, y):
        d = self.rng.choice([1, 1, 1, 2, 2, 3, 4, 5, 10]) * self.rng.choice([-1, 1])
        return y + d


def dress(text, rng, kind="news"):
    """Headline furniture the pipeline actually sees: tails, datelines, attributions."""
    t = text
    r = rng.random()
    if kind == "news":
        if r < .12:
            t = "Breaking: " + t
        elif r < .22:
            t = rng.choice(["NEW DELHI: ", "CHENNAI: ", "MUMBAI: ", "Live updates: "]) + t
        if rng.random() < .15:
            t = t.rstrip(".") + rng.choice([", police said.", ", officials said.", ", reports say.", ", sources said."])
        if rng.random() < .1:
            t = t.rstrip(".")
        if rng.random() < .35:
            t = t.rstrip(".") + " - " + rng.choice(PUBLISHERS)
    return t


class Out:
    def __init__(self, cat):
        self.cat, self.rows = cat, []

    def add(self, premise, hypothesis, label, frame, lang="en", sub=""):
        self.rows.append({"premise": premise, "hypothesis": hypothesis, "label": label, "cat": self.cat,
                          "frame": frame, "lang": lang, "sub": sub})


# ---------------------------------------------------------------- figure
def money_forms(x, unit):
    if unit == "crore":
        return [f"Rs {x} crore", f"₹{x} crore", f"Rs. {x} crore", f"{x * 10} million rupees"]
    return [f"Rs {x} lakh", f"₹{x} lakh", f"Rs. {x} lakh", f"{x * 100000:,} rupees"]


def fill(templates, n, nw=None):
    return [t.replace("{N}", str(n)).replace("{NW}", nw if nw is not None else str(n)) for t in templates]


def g_figure(c):
    o, r = Out("figure"), c.rng
    which = r.choice(["medals", "toll", "wickets", "age", "rate", "money", "projects", "runs", "seats", "percent", "families"])
    if which == "medals":
        team, ev, yr = c.pick("teams", TEAMS), c.pick("events", EVENTS), r.randint(2018, 2028)
        n = r.randint(8, 150)
        claim = f"{team} won {n} medals at the {yr} {ev}." if r.random() < .5 else f"{team} won {n} medals at the {ev} {yr}."
        prem = [f"{team} finished the {yr} {ev} with {{N}} medals", f"{team} bag {{N}} medals at {ev} {yr}",
                f"A haul of {{N}} medals for {team} at the {yr} {ev}", f"{ev} {yr}: {team} end campaign with {{N}} medals"]
        m = c.other_num(n)
        if r.random() < .4:  # the same tally for another edition of the games is a different claim
            other_year = c.other_year(yr)
            o.add(dress(r.choice(fill(prem, n)).replace(str(yr), str(other_year)), r), claim, CON, "medals-year")
            o.add(dress(r.choice(fill(prem, n)), r), claim, ENT, "medals-year")
    elif which == "toll":
        inc, pl = c.pick("inc", INCIDENTS), c.pick("places", PLACES)
        n = r.randint(3, 120)
        claim = f"The {inc} in {pl} killed {n} people."
        prem = [f"{{N}} people were killed in the {inc} in {pl}", f"Death toll in {pl} {inc} rises to {{N}}",
                f"{{N}} dead as {inc} hits {pl}", f"{pl} {inc}: {{N}} lives lost"]
        m = c.other_num(n)
    elif which == "wickets":
        t1, t2 = c.distinct("teams", TEAMS, 2)
        m_, n = c.pick("matches", MATCHES), r.randint(1, 10)
        claim = f"{t1} beat {t2} by {n} wickets in the {m_}."
        prem = [f"{t1} defeat {t2} by {{N}} wickets in the {m_}", f"{t2} lose to {t1} by {{N}} wickets in the {m_}",
                f"{t1} win the {m_} by {{NW}} wickets", f"{t1} beat {t2} by {{N}} wkts in the {m_}"]
        m = r.choice([k for k in range(1, 11) if k != n])
        o.add(dress(r.choice(fill(prem, n, words(n))), r), claim, ENT, which)
        o.add(dress(r.choice(fill(prem, n, words(n))), r), claim, ENT, which)
        o.add(dress(r.choice(fill(prem, m, words(m))), r), claim, CON, which)
        o.add(dress(r.choice(fill(prem, m, words(m))), r), claim, CON, which)
        return o.rows
    elif which == "age":
        p, g = c.person()
        n = r.randint(38, 98)
        claim = f"{p} died at the age of {n}."
        prem = [f"{p}, aged {{N}}, has died", f"{p} passes away at {{N}}", f"{p} dies at {{N}} after a brief illness",
                f"{p} (age {{N}}) died on {r.choice(DAYS)}"]
        m = c.other_num(n, lo=20)
    elif which == "rate":
        n = r.choice([10, 15, 25, 35, 40, 50, 75])
        claim = f"The Reserve Bank of India raised the repo rate by {n} basis points."
        prem = ["RBI raises repo rate by {N} bps", "RBI hikes policy rate by {N} basis points",
                "Reserve Bank lifts repo rate by {N} basis points", "Repo rate up {N} bps as RBI tightens"]
        m = r.choice([k for k in (5, 10, 15, 25, 35, 40, 50, 75, 100) if k != n])
    elif which == "money":
        x, unit = r.randint(2, 90), r.choice(["crore", "lakh"])
        st = c.pick("states", STATES)
        claim = f"{st} will pay {money_forms(x, unit)[0]} for an Olympic gold medal."
        prem = [f"{st} announces {{M}} reward for Olympic gold", f"{{M}} for each Olympic gold winner, {st} government says",
                f"Olympic gold will fetch {{M}} in {st}", f"{st} to give {{M}} to Olympic champions"]
        forms, o_forms = money_forms(x, unit), money_forms(c.other_num(x), unit)
        for _ in range(2):
            o.add(dress(r.choice(prem).replace("{M}", r.choice(forms)), r), claim, ENT, "money")
            o.add(dress(r.choice(prem).replace("{M}", r.choice(o_forms)), r), claim, CON, "money")
        return o.rows
    elif which == "projects":
        (p, g), pl = c.person(), c.pick("places", PLACES)
        x = r.choice([250, 500, 1300, 2400, 5400, 7500, 13000, 25000, 36000, 4700])
        claim = f"{p} launched projects worth Rs {x:,} crore in {pl}."
        forms = [f"Rs {x:,} crore", f"Rs {x} crore", f"₹{x:,} crore", f"Rs. {x:,} crore"]
        shifted = r.choice([x * 10, max(10, x // 10), x + 100 * r.randint(1, 9), int(str(x)[::-1]) if str(x)[::-1] != str(x) else x * 2])
        prem = [f"{p} launches projects worth {{M}} in {pl}", f"{{M}} projects for {pl}: {p} lays foundation", f"{p} inaugurates, lays foundation for works worth {{M}} in {pl}"]
        for _ in range(2):
            o.add(dress(r.choice(prem).replace("{M}", r.choice(forms)), r), claim, ENT, "projects")
            o.add(dress(r.choice(prem).replace("{M}", f"Rs {shifted:,} crore"), r), claim, CON, "projects")
        return o.rows
    elif which == "runs":
        p, g = c.person()
        n, m_ = r.randint(20, 220), c.pick("matches", MATCHES)
        claim = f"{p} scored {n} runs in the {m_}."
        prem = [f"{p} hits {{N}} in the {m_}", f"{{N}} for {p} in the {m_}", f"{p} makes {{N}} runs in the {m_}",
                f"{p} scores {{N}} as team wins the {m_}"]
        m = c.other_num(n)
    elif which == "seats":
        pa, st = c.pick("parties", PARTIES), c.pick("states", STATES)
        n = r.randint(2, 180)
        claim = f"{pa} won {n} seats in {st}."
        prem = [f"{pa} bags {{N}} seats in {st}", f"{st} results: {pa} secures {{N}} seats", f"{pa} wins {{N}} seats in {st} polls",
                f"{pa} ends with {{N}} seats in {st}"]
        m = c.other_num(n)
    elif which == "percent":
        n = r.choice([2, 3, 5, 8, 10, 12, 15, 18, 20, 25, 28, 40])
        goods = r.choice(["GST on packaged food", "interest on small savings", "customs duty on gold", "toll on the expressway"])
        claim = f"The government raised {goods} by {n} per cent."
        cap = goods[0].upper() + goods[1:]
        prem = [f"{cap} hiked by {{N}}%", f"Centre raises {goods} by {{N}} per cent", f"{{N}}% hike in {goods}",
                f"{cap} goes up by {{N}} per cent"]
        m = r.choice([k for k in (1, 2, 3, 5, 8, 10, 12, 15, 18, 20, 25, 28, 40) if k != n])
    else:
        n, st = r.randint(2, 80), c.pick("states", STATES)
        sch = r.choice(SCHEMES)
        claim = f"The {sch} will benefit {n} lakh families in {st}."
        prem = [f"{{N}} lakh families in {st} to gain from {sch}", f"{st}'s {sch} to reach {{N}} lakh families",
                f"{sch[0].upper() + sch[1:]} in {st}: {{N}} lakh families to benefit"]
        m = c.other_num(n)
    for _ in range(2):
        o.add(dress(r.choice(fill(prem, n)), r), claim, ENT, which)
        o.add(dress(r.choice(fill(prem, m)), r), claim, CON, which)
    return o.rows


# ---------------------------------------------------------------- date
def g_date(c):
    o, r = Out("date"), c.rng
    which = r.choice(["event", "elected", "effective", "title", "born", "results"])
    if which == "event":
        ev, y = c.pick("events", EVENTS), r.randint(1990, 2028)
        pl = c.pick("places", PLACES)
        claim = f"The {ev} were held in {pl} in {y}."
        prem = [f"The {ev} took place in {pl} in {y}", f"{pl} hosted the {ev} in {y}", f"{y} {ev} open in {pl}", f"{pl} {y}: the {ev} begin"]
        sw = lambda s, a, b: s.replace(str(a), str(b))
        y2 = c.other_year(y)
        same, other = prem, [sw(x, y, y2) for x in prem]
        fr = "year-event"
    elif which == "elected":
        p, g = c.person()
        y, off, st = r.randint(1985, 2026), r.choice(OFFICES), c.pick("states", STATES)
        claim = f"{p} was elected {off} of {st} in {y}."
        prem = [f"{p} won the {y} election to become {off} of {st}", f"In {y}, {p} was elected {off} of {st}",
                f"{p} took over as {off} of {st} after the {y} polls", f"{st} chose {p} as {off} in {y}"]
        y2 = c.other_year(y)
        same, other = prem, [x.replace(str(y), str(y2)) for x in prem]
        fr = "year-elected"
    elif which == "effective":
        law = r.choice(["new labour code", "GST rate cut", "revised toll policy", "e-challan rule", "new tax slab regime", "ban on plastic bags"])
        d, mo = r.randint(1, 28), r.choice(MONTHS)
        claim = f"The {law} will come into force on {d} {mo}."
        prem = [f"{law[0].upper() + law[1:]} to take effect on {d} {mo}", f"{law[0].upper() + law[1:]} comes into force from {mo} {d}",
                f"From {d} {mo}: {law} kicks in", f"Centre notifies {law}, effective {d} {mo}"]
        r2 = r.random()
        if r2 < .5:
            d2 = d + r.choice([-1, 1]) * r.randint(1, 9)
            d2 = d2 if 1 <= d2 <= 28 and d2 != d else (d % 28) + 1
            other = [x.replace(f"{d} {mo}", f"{d2} {mo}").replace(f"{mo} {d}", f"{mo} {d2}") for x in prem]
        else:
            mo2 = r.choice([m for m in MONTHS if m != mo])
            other = [x.replace(mo, mo2) for x in prem]
        same = prem
        fr = "day-effective"
    elif which == "title":
        t, y = c.pick("teams", TEAMS), r.randint(1980, 2028)
        tn = c.pick("tourneys", TOURNEYS)
        claim = f"{t} won the {tn} in {y}."
        prem = [f"{t} lifted the {tn} in {y}", f"{t} clinched the {y} {tn}", f"{y} {tn}: {t} crowned champions",
                f"{t} are {tn} winners of {y}"]
        y2 = c.other_year(y)
        same, other = prem, [x.replace(str(y), str(y2)) for x in prem]
        fr = "year-title"
    elif which == "born":
        p, g = c.person()
        pr, y = r.choice(PROFS), r.randint(1930, 2000)
        claim = f"{p} was born in {y}."
        prem = [f"{p}, born in {y}, is a {pr}", f"{p} ({y}) is a well-known {pr}", f"Profile: {pr} {p}, born {y}"]
        y2 = c.other_year(y)
        same, other = prem, [x.replace(str(y), str(y2)) for x in prem]
        fr = "year-born"
    else:
        org = r.choice(["The Election Commission", "The CBSE", "The UPSC", "The state board", "Anna University"])
        d, mo = r.randint(1, 28), r.choice(MONTHS)
        claim = f"{org} announced the results on {d} {mo}."
        prem = [f"{org} declares results on {d} {mo}", f"Results out: {org} announced them on {d} {mo}", f"{org} released the results on {mo} {d}"]
        d2 = (d + r.randint(1, 12) - 1) % 28 + 1
        d2 = d2 if d2 != d else (d % 28) + 1
        same, other = prem, [x.replace(f"{d} {mo}", f"{d2} {mo}").replace(f"{mo} {d}", f"{mo} {d2}") for x in prem]
        fr = "day-results"
    for _ in range(2):
        o.add(dress(r.choice(same), r), claim, ENT, fr)
        o.add(dress(r.choice(other), r), claim, CON, fr)
    return o.rows


# ---------------------------------------------------------------- reversed outcome
def g_outcome(c):
    o, r = Out("reversed_outcome"), c.rng
    which = r.choice(["court", "mission", "bill", "approval", "resign", "rate", "ban", "award", "match", "scheme", "bail"])
    if which == "court":
        court, (p, g) = c.pick("courts", COURTS), c.person()
        st = c.pick("states", STATES)
        a = (f"The {court} upheld {p}'s election from {st}.",
             [f"{court} upholds {p}'s election", f"{p}'s win from {st} stands as {court} dismisses petition", f"{court} rejects plea against {p}'s election"])
        b = (f"The {court} set aside {p}'s election from {st}.",
             [f"{court} sets aside {p}'s election", f"{p}'s win from {st} voided by {court}", f"{court} quashes {p}'s election"])
    elif which == "mission":
        ag, ms = c.pick("agencies", AGENCIES), c.pick("missions", MISSIONS)
        a = (f"{ag}'s {ms} succeeded.", [f"{ag}'s {ms} a success", f"{ms}: {ag} achieves its objective", f"{ag} completes {ms} successfully"])
        b = (f"{ag}'s {ms} failed.", [f"{ag}'s {ms} ends in failure", f"{ms}: {ag} falls short of its objective", f"{ag} loses contact, {ms} fails"])
    elif which == "bill":
        bill = c.pick("bills", BILLS)
        a = (f"Parliament passed the {bill}.", [f"Parliament passes {bill}", f"{bill} cleared by both Houses", f"Lok Sabha and Rajya Sabha approve {bill}"])
        b = (f"Parliament rejected the {bill}.", [f"Parliament rejects {bill}", f"{bill} defeated in the Lok Sabha", f"{bill} voted down by MPs"])
    elif which == "approval":
        dr = c.pick("drugs", DRUGS)
        a = (f"The regulator approved the {dr}.", [f"Regulator clears {dr}", f"{dr[0].upper() + dr[1:]} gets approval", f"Green light for {dr}"])
        b = (f"The regulator rejected the {dr}.", [f"Regulator turns down {dr}", f"{dr[0].upper() + dr[1:]} denied approval", f"{dr[0].upper() + dr[1:]} rejected by regulator"])
    elif which == "resign":
        (p, g), off = c.person(), r.choice(OFFICES)
        a = (f"{p} resigned as {off}.", [f"{p} resigns as {off}", f"{p} quits as {off}", f"{p} steps down as {off}"])
        b = (f"{p} refused to resign as {off}.", [f"{p} refuses to resign as {off}", f"{p} rejects calls to quit as {off}", f"{p} will not step down as {off}, says aide"])
    elif which == "rate":
        n = r.choice([25, 35, 50])
        a = (f"The RBI raised the repo rate by {n} basis points.", [f"RBI hikes repo rate by {n} bps", f"RBI raises key rate by {n} basis points"])
        b = (f"The RBI cut the repo rate by {n} basis points.", [f"RBI cuts repo rate by {n} bps", f"RBI lowers key rate by {n} basis points"])
    elif which == "ban":
        th, st = r.choice(THINGS_BAN), c.pick("states", STATES)
        a = (f"{st} banned {th}.", [f"{st} bans {th}", f"Ban on {th} comes into force in {st}", f"{st} government prohibits {th}"])
        b = (f"{st} lifted the ban on {th}.", [f"{st} lifts ban on {th}", f"{st} revokes prohibition on {th}", f"Ban on {th} withdrawn in {st}"])
    elif which == "award":
        (p, g), aw = c.person(), r.choice(AWARDS)
        a = (f"{p} accepted the {aw}.", [f"{p} accepts {aw}", f"{p} receives {aw} with thanks", f"{p} gladly takes the {aw}"])
        b = (f"{p} declined the {aw}.", [f"{p} declines {aw}", f"{p} turns down {aw}", f"{p} returns the {aw}"])
    elif which == "match":
        t1, t2 = c.distinct("teams", TEAMS, 2)
        m = c.pick("matches", MATCHES)
        a = (f"{t1} won the {m}.", [f"{t1} win the {m}", f"{t1} clinch the {m}", f"Victory for {t1} in the {m}"])
        b = (f"{t1} lost the {m}.", [f"{t1} lose the {m}", f"{t1} go down in the {m}", f"Defeat for {t1} in the {m}"])
    elif which == "scheme":
        sch, st = c.pick("schemes", SCHEMES), c.pick("states", STATES)
        a = (f"{st} extended the {sch}.", [f"{st} extends {sch}", f"{sch[0].upper() + sch[1:]} extended by {st}", f"{st} continues the {sch} for another year"])
        b = (f"{st} scrapped the {sch}.", [f"{st} scraps {sch}", f"{sch[0].upper() + sch[1:]} scrapped by {st}", f"{st} discontinues the {sch}"])
    else:
        (p, g) = c.person()
        a = (f"{p} was granted bail.", [f"{p} gets bail", f"Court grants bail to {p}", f"Bail for {p}"])
        b = (f"{p} was denied bail.", [f"{p} denied bail", f"Court rejects bail plea of {p}", f"Bail refused to {p}"])
    sides = [a, b]
    r.shuffle(sides)
    (claim, same_prem), (_, opp_prem) = sides
    for _ in range(2):
        o.add(dress(r.choice(same_prem), r), claim, ENT, which)
        o.add(dress(r.choice(opp_prem), r), claim, CON, which)
    return o.rows


# ---------------------------------------------------------------- reversed roles
def g_roles(c):
    o, r = Out("reversed_roles"), c.rng
    which = r.choice(["beat", "acquire", "appoint", "succeed", "arrest", "election", "sue"])
    if which == "beat":
        A, B = c.distinct("teams", TEAMS, 2)
        m = c.pick("matches", MATCHES)
        claim = f"{A} beat {B} in the {m}."
        same = [f"{A} defeated {B} in the {m}", f"{B} lost to {A} in the {m}", f"{B} were beaten by {A} in the {m}", f"{A} got the better of {B} in the {m}"]
        opp = [f"{B} beat {A} in the {m}", f"{A} lost to {B} in the {m}", f"{A} were beaten by {B} in the {m}", f"{B} defeated {A} in the {m}"]
    elif which == "acquire":
        A, B = c.distinct("companies", COMPANIES, 2)
        claim = f"{A} acquired {B}."
        same = [f"{A} buys {B}", f"{B} was acquired by {A}", f"{B} sold to {A} in a deal", f"{A} takes over {B}"]
        opp = [f"{B} buys {A}", f"{A} was acquired by {B}", f"{A} sold to {B} in a deal", f"{B} takes over {A}"]
    elif which == "appoint":
        (A, _), (B, _) = c.person(), c.person()
        if A == B:
            return []
        off = r.choice(OFFICES)
        claim = f"{A} appointed {B} as {off}."
        same = [f"{A} names {B} {off}", f"{B} was appointed {off} by {A}", f"{B} gets {off} post from {A}"]
        opp = [f"{B} names {A} {off}", f"{A} was appointed {off} by {B}", f"{A} gets {off} post from {B}"]
    elif which == "succeed":
        (A, _), (B, _) = c.person(), c.person()
        if A == B:
            return []
        off = r.choice(OFFICES)
        claim = f"{A} succeeded {B} as {off}."
        same = [f"{A} takes over from {B} as {off}", f"{B} was succeeded by {A} as {off}", f"{A} replaces {B} as {off}"]
        opp = [f"{B} takes over from {A} as {off}", f"{A} was succeeded by {B} as {off}", f"{B} replaces {A} as {off}"]
    elif which == "arrest":
        (A, _) = c.person()
        pl = c.pick("places", PLACES)
        claim = f"{pl} police arrested {A}."
        same = [f"{A} arrested by {pl} police", f"{pl} police take {A} into custody", f"{A} held by {pl} police"]
        opp = [f"{A} files complaint against {pl} police", f"{A} accuses {pl} police of harassment", f"{pl} police chief meets {A}"]
        for _ in range(2):
            o.add(dress(r.choice(same), r), claim, ENT, which)
            o.add(dress(r.choice(opp), r), claim, NEU, which)
        return o.rows
    elif which == "election":
        (A, _), (B, _) = c.person(), c.person()
        if A == B:
            return []
        seat = c.pick("places", PLACES)
        claim = f"{A} defeated {B} in the {seat} constituency."
        same = [f"{A} beats {B} in {seat}", f"{B} loses {seat} seat to {A}", f"{A} wins {seat}, defeating {B}"]
        opp = [f"{B} beats {A} in {seat}", f"{A} loses {seat} seat to {B}", f"{B} wins {seat}, defeating {A}"]
    else:
        (A, _) = c.person()
        co = c.pick("companies", COMPANIES)
        claim = f"{A} sued {co}."
        same = [f"{A} takes {co} to court", f"{co} sued by {A}", f"{A} files suit against {co}"]
        opp = [f"{co} sues {A}", f"{A} sued by {co}", f"{co} takes {A} to court"]
    for _ in range(2):
        o.add(dress(r.choice(same), r), claim, ENT, which)
        o.add(dress(r.choice(opp), r), claim, CON, which)
    return o.rows


# ---------------------------------------------------------------- debunk / confirm
def g_debunk(c):
    o, r = Out("debunk"), c.rng
    (p, g) = c.person()
    if r.random() < .45:
        act = r.choice(ACTIVITIES)
        claim = r.choice([f"A video shows {p} {act}.", f"A viral video shows {p} {act}.", f"A video of {p} {act} is circulating."])
        deb = [f"Fact check: video of {p} {act} is AI-generated", f"Viral video of {p} {act} is a deepfake",
               f"No, this video does not show {p} {act}: it is edited", f"Old video falsely shared as {p} {act}",
               f"PIB Fact Check: video of {p} {act} is fake", f"Video of {p} {act} is digitally manipulated, fact-checkers find"]
        conf = [f"Fact check: video of {p} {act} is genuine", f"Video of {p} {act} verified as authentic",
                f"Fact check: yes, the video does show {p} {act}"]
        act2 = r.choice([a for a in ACTIVITIES if a != act])
        unrelated = [f"Fact check: video of {p} {act2} is AI-generated", f"Viral video of {p} {act2} is a deepfake"]
        fr = "video"
    else:
        th = r.choice(THEME_NAMES)
        pred = r.choice(THEMES[th])
        claim = f"{p} {pred}."
        cw = r.choice(CLAIM_WORDS)
        deb = [f"Fact check: claim that {p} {pred} is false", f"{cw} that {p} {pred} is fake", f"No, it is not true that {p} {pred}",
               f"Fake news alert: the post saying {p} {pred} is misleading", f"Fact Check: Did {p} really do this? Claim debunked",
               f"Claim that {p} {pred} is false, say fact-checkers"]
        conf = [f"Fact check: claim that {p} {pred} is true", f"{cw} that {p} {pred} found to be accurate",
                f"Verified: {p} {pred}", f"Fact check: yes, {p} {pred}"]
        th2 = r.choice([t for t in THEME_NAMES if t != th])
        pred2 = r.choice(THEMES[th2])
        unrelated = [f"Fact check: claim that {p} {pred2} is false", f"{cw} that {p} {pred2} is fake"]
        fr = "claim"
    for _ in range(2):
        o.add(dress(r.choice(deb), r), claim, CON, fr + "-debunk")
    o.add(dress(r.choice(conf), r), claim, ENT, fr + "-confirm")
    o.add(dress(r.choice(unrelated), r), claim, NEU, fr + "-other")
    return o.rows


# ---------------------------------------------------------------- same entity unrelated
def g_themes_unrelated(c):
    o, r = Out("same_entity"), c.rng
    if r.random() < .75:
        (p, g) = c.person()
        t1, t2 = r.sample(THEME_NAMES, 2)
        a, b = r.choice(THEMES[t1]), r.choice(THEMES[t2])
        claim = f"{p} {a}."
        prem = r.choice([f"{p} {b}", f"{p} {b}, say reports", f"{p} {b} on {r.choice(DAYS)}"])
        fr = "person"
    elif r.random() < .5:
        ag = c.pick("agencies", AGENCIES)
        m1, m2 = c.distinct("missions", MISSIONS, 2)
        claim = f"{ag} launched the {m1}."
        prem = r.choice([f"{ag} plans the {m2} next year", f"{ag} chief reviews {m2} preparations", f"{ag} signs pact ahead of {m2}"])
        fr = "agency"
    else:
        (p, g), (q, _) = c.person(), c.person()
        if p == q:
            return []
        th = r.choice(THEME_NAMES)
        pred = r.choice(THEMES[th])
        claim = f"{p} {pred}."
        prem = r.choice([f"{q} {pred}", f"{q} {pred}, say reports"])
        fr = "other-person"
    o.add(dress(prem, r), claim, NEU, fr)
    # a second neutral pair from generic news: two stories about the same place or event type
    pl = c.pick("places", PLACES)
    t1, t2 = c.distinct("teams", TEAMS, 2)
    ev = c.pick("events", EVENTS)
    o.add(dress(r.choice([f"Heavy rain lashes {pl}", f"{pl} to get new metro line", f"Power cut in {pl} on {r.choice(DAYS)}"]), r),
          r.choice([f"{t1} won {r.randint(10, 90)} medals at the {ev}.", f"The {r.choice(INCIDENTS)} in {pl} killed {r.randint(3, 60)} people."]),
          NEU, "topic")
    return o.rows


# ---------------------------------------------------------------- paraphrase
def g_paraphrase(c):
    o, r = Out("paraphrase"), c.rng
    which = r.choice(["launch", "died", "won", "ban", "resign", "arrest", "bill", "appoint", "abbr", "sched", "ordinal"])
    if which == "launch":
        ag, (p, g) = c.pick("agencies", AGENCIES), c.person()
        sch = c.pick("schemes", SCHEMES)
        claim = f"{ag} launched the {sch}."
        prem = [f"The {sch} was launched by {ag}", f"{ag} unveiled the {sch}", f"{ag} has launched the {sch}, it said", f"{ag} rolls out {sch}"]
    elif which == "died":
        (p, g), pl = c.person(), c.pick("places", PLACES)
        pr = r.choice(PROFS)
        claim = f"{p} died in {pl}."
        prem = [f"{p} passed away in {pl}", f"{pr.capitalize()} {p} has died in {pl}", f"{p} dies in {pl}", f"{p}, the {pr}, died in {pl}, family sources said"]
    elif which == "won":
        t, tn = c.pick("teams", TEAMS), c.pick("tourneys", TOURNEYS)
        claim = f"{t} won the {tn}."
        prem = [f"{t} clinched the {tn}", f"{t} lifted the {tn} trophy", f"{t} are the {tn} champions", f"The {tn} was won by {t}"]
    elif which == "ban":
        th, st = r.choice(THINGS_BAN), c.pick("states", STATES)
        claim = f"{st} banned {th}."
        prem = [f"{th[0].upper() + th[1:]} has been banned by {st}", f"{st} imposes ban on {th}", f"Ban on {th} announced by {st} government"]
    elif which == "resign":
        (p, g), off = c.person(), r.choice(OFFICES)
        claim = f"{p} resigned as {off}."
        prem = [f"{p} quit as {off}", f"{p} stepped down as {off}", f"{p} has resigned from the post of {off}", f"{off} {p} resigns"]
    elif which == "arrest":
        (p, g), pl = c.person(), c.pick("places", PLACES)
        claim = f"{p} was arrested in {pl}."
        prem = [f"{pl} police arrested {p}", f"{p} taken into custody in {pl}", f"Arrest in {pl}: {p} held by police"]
    elif which == "bill":
        bill = c.pick("bills", BILLS)
        claim = f"The {bill} was passed by Parliament."
        prem = [f"Parliament passed the {bill}", f"Parliament approves {bill}", f"{bill} gets Parliament nod", f"Lok Sabha and Rajya Sabha clear {bill}"]
    elif which == "appoint":
        (p, g), off = c.person(), r.choice(OFFICES)
        claim = f"{p} was appointed {off}."
        prem = [f"{p} named {off}", f"{p} has been appointed as {off}", f"{p} takes charge as {off}", f"Government appoints {p} as {off}"]
    elif which == "abbr":
        n, pl = r.choice([25, 50, 35]), c.pick("states", STATES)
        pairs = [(f"The Reserve Bank of India raised the repo rate by {n} basis points.", [f"RBI raised the repo rate by {n} bps.", f"RBI hikes repo by {n} basis points"]),
                 (f"The Chief Minister of {pl} announced a relief package.", [f"{pl} CM announces relief package", f"{pl} Chief Minister unveils relief package"]),
                 (f"The Prime Minister inaugurated the new airport in {r.choice(PLACES)}.", None),
                 (f"The Supreme Court stayed the order of the High Court.", ["SC stays HC order", "Supreme Court puts High Court order on hold"])]
        claim, prem = r.choice([x for x in pairs if x[1]])
    elif which == "ordinal":
        (A, B), n, k, city = c.distinct("teams", TEAMS, 2), r.randint(1, 9), r.randint(1, 5), c.pick("places", PLACES)
        ordinals = {1: ("first", "1st"), 2: ("second", "2nd"), 3: ("third", "3rd"), 4: ("fourth", "4th"), 5: ("fifth", "5th")}
        fmt = r.choice(["T20I", "ODI", "Test"])
        claim = f"{A} beat {B} by {words(n)} wickets in the {ordinals[k][0]} {fmt} in {city}."
        prem = [f"{A} defeated {B} by {n} wickets in the {ordinals[k][1]} {fmt} at {city}", f"{B} lost to {A} by {n} wickets in the {ordinals[k][1]} {fmt} in {city}",
                f"{A} win {ordinals[k][1]} {fmt} at {city} by {words(n)} wickets, beating {B}"]
    else:
        x, unit = r.randint(2, 90), r.choice(["crore", "lakh"])
        forms = money_forms(x, unit)
        st = c.pick("states", STATES)
        claim = f"{st} will pay {forms[0]} as compensation to each family."
        prem = [f"{st} announces {f} compensation for each family" for f in forms[1:]]
    for _ in range(2):
        o.add(dress(r.choice(prem), r), claim, ENT, which)
    if which == "ordinal":
        m = r.choice([x for x in range(1, 10) if x != n])
        o.add(dress(r.choice(prem).replace(f" {n} wickets", f" {m} wickets").replace(words(n) + " wickets", words(m) + " wickets"), r), claim, CON, "ordinal-figure")
    return o.rows


# ---------------------------------------------------------------- unsupported detail
def g_unsupported(c):
    o, r = Out("unsupported"), c.rng
    which = r.choice(["died", "rate", "attack", "win", "arrest", "bill"])
    if which == "died":
        (p, g), pl, n = c.person(), c.pick("places", PLACES), r.randint(40, 95)
        pr = r.choice(PROFS)
        claim = r.choice([f"{p} died in {pl}.", f"{p} died at the age of {n}.", f"{p} died of a heart attack."])
        prem = r.choice([f"{pr.capitalize()} {p} dies", f"{p} passes away", f"Obituary: {p}", f"Tributes pour in for {p}"])
    elif which == "rate":
        n = r.choice([25, 35, 50])
        claim = f"The RBI raised the repo rate by {n} basis points."
        prem = r.choice(["RBI raises repo rate", "RBI announces repo rate decision", "RBI announces monetary policy outcome"])
    elif which == "attack":
        pl, n = c.pick("places", PLACES), r.randint(3, 60)
        inc = c.pick("inc", INCIDENTS)
        claim = f"The {inc} in {pl} killed {n} people."
        prem = r.choice([f"{inc[0].upper() + inc[1:]} in {pl}: rescue under way", f"Several injured in {pl} {inc}", f"{pl} {inc}: probe ordered"])
    elif which == "win":
        t1, t2 = c.distinct("teams", TEAMS, 2)
        m, n = c.pick("matches", MATCHES), r.randint(1, 9)
        claim = r.choice([f"{t1} beat {t2} by {n} wickets in the {m}.", f"{t1} beat {t2} in the {m} with a century from the captain."])
        prem = r.choice([f"{t1} v {t2}: preview of the {m}", f"{t1} and {t2} meet in the {m}", f"Toss delayed for the {m}"])
    elif which == "arrest":
        (p, g), pl = c.person(), c.pick("places", PLACES)
        claim = f"{p} was arrested in {pl}."
        prem = r.choice([f"Police raid in {pl}", f"{p} questioned in {pl}", f"{p} appears before the court in {pl}"])
    else:
        bill = c.pick("bills", BILLS)
        claim = f"The {bill} was passed by Parliament with a two-thirds majority."
        prem = r.choice([f"{bill} introduced in Parliament", f"Debate on {bill} begins", f"{bill} referred to a select committee"])
    o.add(dress(prem, r), claim, NEU, which)
    return o.rows


# ---------------------------------------------------------------- encyclopedic
def bundle(c):
    r = c.rng
    p, g = c.person()
    by = r.randint(1930, 1996)
    bm, bd = r.choice(MONTHS), r.randint(1, 28)
    dead = r.random() < .6
    dy = r.randint(max(by + 30, 1990), 2026) if dead else None
    dm, dd = r.choice(MONTHS), r.randint(1, 28)
    return {"name": p, "g": g, "prof": r.choice(PROFS), "by": by, "bdm": f"{bd} {bm}", "bp": c.pick("places", PLACES),
            "dead": dead, "dy": dy, "died": f"{dd} {dm} {dy}" if dead else None, "dm": dm,
            "dp": c.pick("places", PLACES), "off": r.choice(OFFICES), "st": c.pick("states", STATES),
            "award": r.choice(AWARDS), "awy": r.randint(1975, 2025), "cs": r.randint(1960, 2015)}


def passage(b, r, death=True, death_place=True, birth_place=True, award=None, office=None):
    he, his = ("He", "his") if b["g"] == "m" else ("She", "her")
    life = f"{b['bdm']} {b['by']}" + (f" – {b['died']}" if b["dead"] and death else "")
    first = f"{b['name']} ({'born ' if not (b['dead'] and death) else ''}{life}) {'was' if b['dead'] and death else 'is'} an Indian {b['prof']}."
    s = [first]
    if birth_place:
        s.append(f"{he} was born in {b['bp']}.")
    s.append(r.choice([f"{he} began {his} career in {b['cs']}.", f"{he} is known for {his} work in {b['st']}.", f"{he} has received several honours."]))
    if award:
        s.append(f"{he} won the {award[0]} in {award[1]}.")
    if office:
        s.append(f"{he} has served as {office[0]} of {office[1]} since {office[2]}.")
    if b["dead"] and death:
        age = b["dy"] - b["by"]
        s.append(f"{he} died{' in ' + b['dp'] if death_place else ''} on {b['died']}{'' if not r.random() < .5 else ' at the age of ' + str(age)}.")
    return " ".join(s)


def g_encyclopedic(c):
    o, r = Out("encyclopedic"), c.rng
    b = bundle(c)
    he = "he" if b["g"] == "m" else "she"
    which = r.choice(["died_place", "died_year", "born_place", "born_year", "award", "office", "event", "capital"])
    if which == "capital":
        st = c.pick("states", STATES)
        cap = STATE_CAPITALS[st]
        wrong = r.choice([v for v in STATE_CAPITALS.values() if v != cap])
        claim = f"{cap} is the capital of {st}."
        o.add(r.choice([f"The capital of {st} is {cap}.", f"{st} is a state in India. Its capital is {cap}.", f"{cap} is the seat of government of {st}."]), claim, ENT, "capital")
        o.add(r.choice([f"The capital of {st} is {wrong}.", f"{st} is a state in India. Its capital is {wrong}."]), claim, CON, "capital")
        o.add(r.choice([f"{st} is a state in southern, eastern or western India, known for its culture and cuisine.", f"{st} has a population of several million people and a long coastline or border."]), claim, NEU, "capital")
        return o.rows
    if which == "died_place":
        claim = f"{b['name']} died in {b['dp']}."
        if b["dead"]:
            o.add(passage(b, r), claim, ENT, "died_place")
            o.add(passage(b, r, death_place=False), claim, NEU, "died_place-noplace")
            other = dict(b, dp=r.choice([x for x in PLACES if x != b["dp"]]))
            o.add(passage(other, r), claim, CON, "died_place-other")
        o.add(passage(dict(b, dead=False), r), claim, NEU, "died_place-alive")
    elif which == "died_year":
        if not b["dead"]:
            return []
        claim = r.choice([f"{b['name']} died in {b['dy']}.", f"{b['name']} died in {b['dm']} {b['dy']}."])
        o.add(passage(b, r), claim, ENT, "died_year")
        y2 = c.other_year(b["dy"])
        claim2 = claim.replace(str(b["dy"]), str(y2))
        o.add(passage(b, r), claim2, CON, "died_year-other")
        o.add(passage(dict(b, dead=False), r), claim, NEU, "died_year-alive")
    elif which == "born_place":
        claim = f"{b['name']} was born in {b['bp']}."
        o.add(passage(b, r), claim, ENT, "born_place")
        o.add(passage(b, r, birth_place=False), claim, NEU, "born_place-absent")
        o.add(passage(dict(b, bp=r.choice([x for x in PLACES if x != b["bp"]])), r), claim, CON, "born_place-other")
    elif which == "born_year":
        claim = f"{b['name']} was born in {b['by']}."
        o.add(passage(b, r), claim, ENT, "born_year")
        o.add(passage(dict(b, by=c.other_year(b["by"])), r), claim, CON, "born_year-other")
    elif which == "award":
        claim = f"{b['name']} won the {b['award']} in {b['awy']}."
        o.add(passage(b, r, award=(b["award"], b["awy"])), claim, ENT, "award")
        o.add(passage(b, r, award=(b["award"], c.other_year(b["awy"]))), claim, CON, "award-other-year")
        o.add(passage(b, r, award=(r.choice([a for a in AWARDS if a != b["award"]]), b["awy"])), claim, NEU, "award-other-award")
        o.add(passage(b, r), claim, NEU, "award-absent")
    elif which == "office":
        claim = f"{b['name']} is the {b['off']} of {b['st']}."
        o.add(passage(dict(b, dead=False), r, office=(b["off"], b["st"], b["cs"])), claim, ENT, "office")
        (q, _) = c.person()
        if q != b["name"]:
            o.add(f"The current {b['off']} of {b['st']} is {q}.", claim, CON, "office-other")
        o.add(passage(dict(b, dead=False), r), claim, NEU, "office-absent")
    else:
        ev = r.choice([f"resigned as {b['off']}", f"was arrested in {b['dp']}", f"won the by-election in {b['dp']}", f"announced a new party",
                       f"was hospitalised in {b['dp']}", f"was summoned by the {r.choice(COURTS)}"])
        claim = f"{b['name']} {ev}."
        o.add(passage(dict(b, dead=False), r), claim, NEU, "event")
        o.add(passage(b, r), claim, NEU, "event")
    return o.rows


# ---------------------------------------------------------------- multilingual
# (headline, headline with the figure/outcome changed, paraphrase of the headline, English claim)
HI_FRAMES = {
    "wickets": ("{a} ने {b} को {wk} विकेट से हराया।", "{b} ने {a} को {wk} विकेट से हराया।",
                "{a} ने {b} को {wk} विकेट से मात दी।", "{A} beat {B} by {wk} wickets."),
    "medals": ("{a} ने एशियाई खेलों में {n} पदक जीते।", "{a} ने एशियाई खेलों में {n2} पदक जीते।",
               "एशियाई खेलों में {a} के नाम {n} पदक रहे।", "{A} won {n} medals at the Asian Games."),
    "toll": ("{pl} में हुए हादसे में {n} लोगों की मौत हो गई।", "{pl} में हुए हादसे में {n2} लोगों की मौत हो गई।",
             "{pl} हादसे में {n} लोगों की जान गई।", "{n} people died in the accident in {P}."),
    "rate": ("आरबीआई ने रेपो दर {k} आधार अंक बढ़ा दी।", "आरबीआई ने रेपो दर {k} आधार अंक घटा दी।",
             "आरबीआई ने रेपो दर में {k} आधार अंक की बढ़ोतरी की।", "The RBI raised the repo rate by {k} basis points."),
    "year": ("{a} ने {y} में विश्व कप जीता।", "{a} ने {y2} में विश्व कप जीता।",
             "{y} में विश्व कप {a} के नाम रहा।", "{A} won the World Cup in {y}."),
}
TA_FRAMES = {
    "wickets": ("{a} அணி {b} அணியை {wk} விக்கெட் வித்தியாசத்தில் வென்றது.", "{b} அணி {a} அணியை {wk} விக்கெட் வித்தியாசத்தில் வென்றது.",
                "{b} அணியை {a} அணி {wk} விக்கெட் வித்தியாசத்தில் வீழ்த்தியது.", "{A} beat {B} by {wk} wickets."),
    "medals": ("{a} ஆசிய விளையாட்டுப் போட்டிகளில் {n} பதக்கங்களை வென்றது.", "{a} ஆசிய விளையாட்டுப் போட்டிகளில் {n2} பதக்கங்களை வென்றது.",
               "ஆசிய விளையாட்டுப் போட்டிகளில் {a} {n} பதக்கங்கள் பெற்றது.", "{A} won {n} medals at the Asian Games."),
    "toll": ("{pl} நடந்த விபத்தில் {n} பேர் உயிரிழந்தனர்.", "{pl} நடந்த விபத்தில் {n2} பேர் உயிரிழந்தனர்.",
             "{pl} நடந்த விபத்தில் {n} பேர் பலியாகினர்.", "{n} people died in the accident in {P}."),
    "rate": ("ரிசர்வ் வங்கி ரெப்போ விகிதத்தை {k} அடிப்படை புள்ளிகள் உயர்த்தியது.", "ரிசர்வ் வங்கி ரெப்போ விகிதத்தை {k} அடிப்படை புள்ளிகள் குறைத்தது.",
             "ரிசர்வ் வங்கி ரெப்போ விகிதத்தை {k} அடிப்படை புள்ளிகள் அதிகரித்தது.", "The RBI raised the repo rate by {k} basis points."),
    "year": ("{a} அணி {y} ஆம் ஆண்டு உலகக் கோப்பையை வென்றது.", "{a} அணி {y2} ஆம் ஆண்டு உலகக் கோப்பையை வென்றது.",
             "{y} ஆம் ஆண்டு உலகக் கோப்பை {a} அணிக்கு கிடைத்தது.", "{A} won the World Cup in {y}."),
}
ML_TEAMS = [t for t in TEAMS if t in HI_TEAMS]
ML_PLACES = list(HI_PLACES)


def g_multilingual(c):
    o, r = Out("multilingual"), c.rng
    lang = r.choice(["hi", "ta"])
    frames, T, P = (HI_FRAMES, HI_TEAMS, HI_PLACES) if lang == "hi" else (TA_FRAMES, TA_TEAMS, TA_PLACES)
    A, B = c.distinct("ml_teams", ML_TEAMS, 2)
    place = c.pick("ml_places", ML_PLACES)
    n, y = r.randint(2, 120), r.randint(1983, 2027)
    slots = {"a": T[A], "b": T[B], "A": A, "B": B, "pl": P[place], "P": place, "n": n, "n2": c.other_num(n),
             "wk": r.randint(1, 10), "y": y, "y2": c.other_year(y), "k": r.choice([25, 50])}
    which = r.choice(list(frames))
    base, changed, para, en = (t.format(**slots) for t in frames[which])
    mode = r.choice(["x-en", "x-en", "en-x", "x-x"])
    if mode == "x-en":
        o.add(base, en, ENT, which + "-x-en", lang)
        o.add(changed, en, CON, which + "-x-en", lang)
    elif mode == "en-x":
        o.add(en, base, ENT, which + "-en-x", lang)
        o.add(en, changed, CON, which + "-en-x", lang)
    else:
        o.add(para, base, ENT, which + "-x-x", lang)
        o.add(changed, base, CON, which + "-x-x", lang)
    other = r.choice([k for k in frames if k != which])
    unrelated = frames[other][0].format(**slots)
    o.add(unrelated, base if mode == "x-x" else en, NEU, "topic-" + lang, lang)
    return o.rows


# ---------------------------------------------------------------- sibling events, swapped actors, number formats
BYPOLL_KINDS = ["bypoll", "by-election", "assembly seat"]


def g_sibling(c):
    """Same subject and verb, a different named event, place or object: two claims, neither supports the other."""
    o, r = Out("sibling_event"), c.rng
    which = r.choice(["bypoll", "match", "tournament", "scheme", "court", "company", "inaugurate", "visit"])
    if which == "bypoll":
        pa, (p1, p2), kind = c.pick("parties", PARTIES), c.distinct("places", PLACES, 2), r.choice(BYPOLL_KINDS)
        claim = f"{pa} won the {p1} {kind}."
        prem = r.choice([f"{pa} won the {p2} {kind}", f"{pa} wins {p2} {kind}", f"{p2} {kind}: {pa} victorious"])
    elif which == "match":
        (A, B), (m1, m2) = c.distinct("teams", TEAMS, 2), c.distinct("matches", MATCHES, 2)
        claim = f"{A} beat {B} in the {m1}."
        prem = r.choice([f"{A} beat {B} in the {m2}", f"{A} defeat {B} in the {m2}", f"{B} lose to {A} in the {m2}"])
    elif which == "tournament":
        A, (t1, t2), y = c.pick("teams", TEAMS), c.distinct("tourneys", TOURNEYS, 2), r.randint(1990, 2028)
        claim = f"{A} won the {t1} in {y}."
        prem = r.choice([f"{A} won the {t2} in {y}", f"{A} lift the {t2} in {y}", f"{y}: {A} crowned {t2} champions"])
    elif which == "scheme":
        st, (s1, s2) = c.pick("states", STATES), c.distinct("schemes", SCHEMES, 2)
        claim = f"{st} launched the {s1}."
        prem = r.choice([f"{st} launches {s2}", f"{st} unveils the {s2}", f"{st} rolls out {s2}"])
    elif which == "court":
        court, (p, _), st = c.pick("courts", COURTS), c.person(), c.pick("states", STATES)
        claim = f"The {court} reserved orders on {p}'s petition."
        prem = r.choice([f"{court} extends stay on by-elections in five {st} seats", f"{court} dismisses a plea on {st} school fees",
                         f"{court} seeks the state's reply on a petition about {st} toll plazas"])
    elif which == "inaugurate":
        (p, _), (p1, p2), thing = c.person(), c.distinct("places", PLACES, 2), r.choice(["bridge", "hospital", "metro station", "flyover", "school", "bus terminus"])
        claim = f"{p} inaugurated a {thing} in {p1}."
        prem = r.choice([f"{p} inaugurates {thing} in {p2}", f"{p} opens a new {thing} in {p2}"])
    elif which == "company":
        (c1, c2), n, what = c.distinct("companies", COMPANIES, 2), r.randint(2, 40), r.choice(["profit", "revenue", "sales"])
        claim = f"{c1} reported a {n} per cent rise in quarterly {what}."
        prem = r.choice([f"{c2} reports {n}% rise in quarterly {what}", f"{c2} Q2 {what} up {n} per cent", f"{c2}'s {what} jumps {n}%"])
    else:
        (p, _), (p1, p2) = c.person(), c.distinct("places", PLACES, 2)
        claim = f"{p} visited {p1}."
        prem = r.choice([f"{p} visits {p2}", f"{p} arrives in {p2}", f"{p} to visit {p2} next week"])
    o.add(dress(prem, r), claim, NEU, which)
    return o.rows


def g_swapped(c):
    """One seat, one winner: a headline naming somebody else as the winner contradicts the claim; naming the same one supports it."""
    o, r = Out("swapped_actor"), c.rng
    which = r.choice(["bypoll", "title", "appoint", "award", "match"])
    if which == "bypoll":
        (A, B), pl, kind = c.distinct("parties", PARTIES, 2), c.pick("places", PLACES), r.choice(BYPOLL_KINDS)
        claim = f"{A} won the {pl} {kind}."
        same = [f"{A} wins {pl} {kind}", f"{pl} {kind}: {A} victorious", f"{A} bags the {pl} {kind}"]
        other = [f"{B} wins {pl} {kind}", f"{pl} {kind}: {B} victorious", f"{B} bags the {pl} {kind}", f"{B} won the {pl} {kind}"]
    elif which == "title":
        (A, B), tn, y = c.distinct("teams", TEAMS, 2), c.pick("tourneys", TOURNEYS), r.randint(1990, 2028)
        claim = f"{A} won the {tn} in {y}."
        same = [f"{A} lift the {tn} in {y}", f"{y} {tn}: {A} crowned champions", f"{A} clinch the {y} {tn}"]
        other = [f"{B} lift the {tn} in {y}", f"{y} {tn}: {B} crowned champions", f"{B} clinch the {y} {tn}", f"{B} won the {tn} in {y}"]
    elif which == "appoint":
        (A, _), (B, _), off, st = c.person(), c.person(), r.choice(OFFICES), c.pick("states", STATES)
        if A == B:
            return []
        claim = f"{A} was appointed {off} of {st}."
        same = [f"{A} named {off} of {st}", f"{A} takes charge as {off} of {st}", f"{st} gets {A} as {off}"]
        other = [f"{B} named {off} of {st}", f"{B} takes charge as {off} of {st}", f"{st} gets {B} as {off}", f"{B} was appointed {off} of {st}"]
    elif which == "award":
        (A, _), (B, _), aw, y = c.person(), c.person(), r.choice(AWARDS), r.randint(1975, 2026)
        if A == B:
            return []
        claim = f"{A} won the {aw} in {y}."
        same = [f"{A} receives the {aw} for {y}", f"{y} {aw} goes to {A}", f"{A} named {aw} winner for {y}"]
        other = [f"{B} receives the {aw} for {y}", f"{y} {aw} goes to {B}", f"{B} named {aw} winner for {y}", f"{B} won the {aw} in {y}"]
    else:
        (A, B), m = c.distinct("teams", TEAMS, 2), c.pick("matches", MATCHES)
        claim = f"{A} won the {m}."
        same = [f"{A} win the {m}", f"{A} clinch the {m}", f"{B} lose the {m}"]
        other = [f"{B} win the {m}", f"{B} clinch the {m}", f"{A} lose the {m}"]
    for _ in range(2):
        o.add(dress(r.choice(same), r), claim, ENT, which)
        o.add(dress(r.choice(other), r), claim, CON, which)
    return o.rows


def indian_group(n):
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    return ",".join(([head] if head else []) + parts + [tail])


def g_numfmt(c):
    """The same figure written differently is the same figure; a different figure is not."""
    o, r = Out("number_format"), c.rng
    which = r.choice(["percent", "rupees", "lakh", "count"])
    if which == "percent":
        vals = [x / 4 for x in range(14, 33)]
        v = r.choice(vals)
        w = r.choice([x for x in vals if x != v])
        form = lambda x: r.choice([f"{x:g}%", f"{x:.2f}%", f"{x:g} per cent", f"{x:g} percent", f"{x:.1f} per cent" if x * 10 == int(x * 10) else f"{x:g}%"])  # noqa: E731
        claim = f"The repo rate was raised to {form(v)}."
        tmpl = ["RBI lifts repo rate to {X}", "Repo rate now {X} after RBI hike", "RBI raises the repo rate to {X}, says governor"]
    elif which == "rupees":
        vals = [50, 100, 200, 500, 1000, 2000, 2500, 5000, 10000, 25000, 50000, 100000]
        v = r.choice(vals)
        w = r.choice([x for x in vals if x != v])
        form = lambda x: r.choice([f"Rs {x:,}", f"Rs {x}", f"₹{x:,}", f"INR {x:,}", f"{x:,} rupees", f"Rs. {x:,}"])  # noqa: E731
        what = r.choice(["fine for the offence", "assistance to each family", "monthly pension", "entry fee"])
        claim = f"The {what} is {form(v)}."
        tmpl = ["The " + what + " has been set at {X}", "New " + what + ": {X}", "{X} as " + what + ", says government"]
    elif which == "lakh":
        vals = [1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 50]
        v = r.choice(vals)
        w = r.choice([x for x in vals if x != v])
        form = lambda x: r.choice([f"Rs {x} lakh", f"Rs {indian_group(x * 100000)}", f"Rs {x * 100000:,}", f"{x * 100000:,} rupees", f"₹{x} lakh", f"{x * 100000 // 1000} thousand rupees" if x < 10 else f"Rs {x} lakh"])  # noqa: E731
        claim = f"Each family will receive {form(v)} as compensation."
        tmpl = ["Compensation of {X} for each family", "Each affected family to get {X}", "{X} relief announced for every family"]
    else:
        vals = list(range(2, 20))
        v = r.choice(vals)
        w = r.choice([x for x in vals if x != v])
        form = lambda x: r.choice([str(x), words(x)])  # noqa: E731
        noun = r.choice(["people", "students", "workers", "passengers"])
        claim = f"{v} {noun} were injured in the accident."
        tmpl = ["{X} " + noun + " hurt in the accident", "Accident leaves {X} " + noun + " injured", "{X} " + noun + " were injured, police said"]
    for _ in range(2):
        o.add(dress(r.choice(tmpl).replace("{X}", form(v)), r), claim, ENT, which)
        o.add(dress(r.choice(tmpl).replace("{X}", form(w)), r), claim, CON, which)
    return o.rows


# ---------------------------------------------------------------- same person, different attribute or event
ATTRIBUTES = [  # claims about one person that do not bear on each other
    "was born in {pl}", "died in {pl2}", "starred in a hit film", "studied at a college in {pl}", "founded a charity in {pl}",
    "won the {aw} in {y}", "retired from public life", "wrote a memoir", "was appointed chairman of a state board",
    "resigned as {off}", "was elected to the assembly", "was summoned by a court", "launched a foundation in {pl}"]


SEQUENCES = [("resigned as {off}", "was appointed {off}"), ("was elected {off}", "resigned as {off}"),
             ("was appointed {off}", "was removed as {off}"), ("took charge as {off}", "resigned as {off}")]


def g_bio_unrelated(c):
    o, r = Out("same_entity"), c.rng
    (p, _) = c.person()
    a, b = r.choice(SEQUENCES) if r.random() < .25 else r.sample(ATTRIBUTES, 2)
    pl, pl2 = c.distinct("places", PLACES, 2)
    slots = {"pl": pl, "pl2": pl2, "aw": r.choice(AWARDS), "y": r.randint(1975, 2026), "off": r.choice(OFFICES)}
    o.add(dress(f"{p} {b.format(**slots)}", r), f"{p} {a.format(**slots)}.", NEU, "bio")
    return o.rows


def g_same_entity(c):
    return g_themes_unrelated(c) if c.rng.random() < .5 else g_bio_unrelated(c)


GENS = [  # (name, function, weight)
    ("figure", g_figure, 10), ("date", g_date, 7), ("reversed_outcome", g_outcome, 9), ("reversed_roles", g_roles, 7),
    ("debunk", g_debunk, 7), ("same_entity", g_same_entity, 14), ("paraphrase", g_paraphrase, 8),
    ("unsupported", g_unsupported, 10), ("encyclopedic", g_encyclopedic, 12), ("multilingual", g_multilingual, 7),
    ("sibling_event", g_sibling, 14), ("swapped_actor", g_swapped, 9), ("number_format", g_numfmt, 6),
]

# Frames held out of training entirely: a test over sentence shapes the model never saw.
HELDOUT_SUBS = {"figure": {"runs", "seats"}, "reversed_roles": {"sue", "election"}, "reversed_outcome": {"scheme", "bail"},
                "date": {"year-title"}, "encyclopedic": {"office", "award"}, "paraphrase": {"bill", "appoint"},
                "sibling_event": {"court", "company"}, "swapped_actor": {"award"}, "number_format": {"count"}}


def is_heldout(row):
    subs = HELDOUT_SUBS.get(row["cat"], set())
    return any(row["frame"] == s or row["frame"].startswith(s + "-") for s in subs)


def build(split, n, seed):
    rng = random.Random(seed)
    c = Ctx(rng, "test" if split.startswith("test") else "train")
    weights = [w for _, _, w in GENS]
    rows, seen = [], set()
    tries = 0
    while len(rows) < n and tries < n * 20:
        tries += 1
        name, fn, _ = rng.choices(GENS, weights)[0]
        for row in fn(c):
            heldout = is_heldout(row)
            if split in ("train", "dev") and heldout:
                continue
            if split == "test-unseen" and not heldout:
                continue
            if split == "test-seen" and heldout:
                continue
            key = (row["premise"], row["hypothesis"])
            if key in seen:
                continue
            seen.add(key)
            row["split"] = split
            rows.append(row)
    return rows[:n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--train", type=int, default=90000)
    ap.add_argument("--dev", type=int, default=2000)
    ap.add_argument("--test-seen", type=int, default=4000)
    ap.add_argument("--test-unseen", type=int, default=2500)
    a = ap.parse_args()
    train = build("train", a.train, 1)
    dev = build("dev", a.dev, 2)
    train_hyp = {r["hypothesis"] for r in train}
    dev = [r for r in dev if r["hypothesis"] not in train_hyp]
    tests = build("test-seen", a.test_seen, 3) + build("test-unseen", a.test_unseen, 4)
    tests = [r for r in tests if r["hypothesis"] not in train_hyp]
    for name, rows in (("synth_train", train), ("synth_dev", dev), ("synth_test", tests)):
        with open(f"{a.out}/{name}.jsonl", "w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        from collections import Counter
        print(name, len(rows), dict(Counter(r["label"] for r in rows)), dict(Counter(r["cat"] for r in rows)))


if __name__ == "__main__":
    main()

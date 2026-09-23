# Convergence report — v10-heldout

3 builds per target (elm, ts), 30 random sessions × 20 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| CommunityWorkshops | 6/6 | 6/6 | 6/6 | 70% | 100% | 70% | 100% | 51% / 54% | $4.51 |
| Inventory | 6/6 | 6/6 | 6/6 | 93% | 100% | 93% | 93% | 71% / 51% | $4.11 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

### Looks (styled builds)

| App | Page = logic | Pixels differ: Elm / TS / Elm↔TS | Boxes within 8px: Elm / TS / Elm↔TS | Median box offset (px) |
|---|---|---|---|---|
| CommunityWorkshops | 1/6 | 1.7% / 1.3% / 1.7% | 32% / 34% / 43% | 43 / 43 / 36 |
| Inventory | 0/6 | 2.3% / 0.5% / 2.7% | 33% / 92% / 4% | 43 / 2 / 29 |

*Page = logic*: builds whose page showed exactly the logic's screen in every session. *Pixels differ*: average share of differing pixels between two builds' screenshots of the same state. *Boxes within 8px*: share of elements whose box is within 8px on every edge.

## CommunityWorkshops

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)

- **elm-1: the page differs from the logic in 9 session(s):** screen[2].content.c[2].chosenHeader.c[2].chosenWhen.v: the page shows "·", the screen says " · "
- **elm-2: the page differs from the logic in 9 session(s):** screen[2].content.c[2].chosenHeader.c[2].chosenWhen.v: the page shows "·", the screen says " · "
- **elm-3: the page differs from the logic in 9 session(s):** screen[2].content.c[2].chosenHeader.c[2].chosenWhen.v: the page shows "·", the screen says " · "
- **ts-3: the page differs from the logic in 9 session(s):** screen[2].content.c[2].chosenHeader.c[2].chosenWhen.v: the page shows "·", the screen says " · "
- **ts-2: the page differs from the logic in 9 session(s):** screen[2].content.c[2].chosenHeader.c[2].chosenWhen.v: the page shows "·", the screen says " · "

Contact sheets: `r14-heldout/events/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 70%, ts-2 100%, ts-3 100%

### Divergence in session 1 after 11 action(s)

```
  type "repair3@example.org" into email
  type "compost5@example.org" into name
  type "Compost Guest 5" into email
  click pager.next
  click pager.previous
  type "ben@example.org" into cancelEmail
  click pager.previous
→ choose option 2 in chosenEvent
```

**elm-1, elm-2, elm-3, ts-2, ts-3** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "1 place left"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = ""
    text chosenWhen = "·"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "0 of 0"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "0"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = 
        field name = "compost5@example.org"
        field email = "Compost Guest 5"
        button signUp "Join the waiting list"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for by email address."
        field cancelEmail = ""
        button cancel "Cancel sign-up" (disabled)
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (0 rows)
      section noAttendees
        text noAttendeesTitle = "Nobody yet"
        text noAttendeesHint = "Sign-ups for this event appear here."
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
section toast
  text toast.message = "Managing ."
  button toast.dismiss "Dismiss"
```
**ts-1** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "1 place left"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = "Bread Baking Basics"
    text chosenWhen = "12 Oct · Community Kitchen"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "2 of 3"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "1"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = Bread Baking Basics
        field name = "compost5@example.org"
        field email = "Compost Guest 5"
        button signUp "Sign up"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for Bread Baking Basics by email address."
        field cancelEmail = "ben@example.org"
        button cancel "Cancel sign-up"
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (2 rows)
        row 1:
          text name = "Mia de Vries"
          text email = "mia@example.org"
        row 2:
          text name = "Tom Bakker"
          text email = "tom@example.org"
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
section toast
  text toast.message = "Please enter a name."
  button toast.dismiss "Dismiss"
```

### Divergence in session 2 after 9 action(s)

```
  type "repair1@example.org" into email
  click signUp
  click toast.dismiss
  click signUp
  click toast.dismiss
  click cancel
  click pick on row 1 of eventList
→ choose option 3 in chosenEvent
```

**elm-1, elm-2, elm-3, ts-2, ts-3** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "1 place left"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = ""
    text chosenWhen = "·"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "0 of 0"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "0"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = 
        field name = ""
        field email = "repair1@example.org"
        button signUp "Join the waiting list"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for by email address."
        field cancelEmail = ""
        button cancel "Cancel sign-up" (disabled)
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (0 rows)
      section noAttendees
        text noAttendeesTitle = "Nobody yet"
        text noAttendeesHint = "Sign-ups for this event appear here."
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
section toast
  text toast.message = "Managing ."
  button toast.dismiss "Dismiss"
```
**ts-1** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "1 place left"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = "Bread Baking Basics"
    text chosenWhen = "12 Oct · Community Kitchen"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "2 of 3"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "1"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = Bread Baking Basics
        field name = ""
        field email = "repair1@example.org"
        button signUp "Sign up"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for Bread Baking Basics by email address."
        field cancelEmail = ""
        button cancel "Cancel sign-up" (disabled)
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (2 rows)
        row 1:
          text name = "Mia de Vries"
          text email = "mia@example.org"
        row 2:
          text name = "Tom Bakker"
          text email = "tom@example.org"
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
section toast
  text toast.message = "Managing Bread Baking Basics."
  button toast.dismiss "Dismiss"
```

### Divergence in session 3 after 1 action(s)

```
→ choose option 1 in chosenEvent
```

**elm-1, elm-2, elm-3, ts-2, ts-3** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "1 place left"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = ""
    text chosenWhen = "·"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "0 of 0"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "0"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = 
        field name = ""
        field email = ""
        button signUp "Join the waiting list"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for by email address."
        field cancelEmail = ""
        button cancel "Cancel sign-up" (disabled)
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (0 rows)
      section noAttendees
        text noAttendeesTitle = "Nobody yet"
        text noAttendeesHint = "Sign-ups for this event appear here."
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
section toast
  text toast.message = "Managing ."
  button toast.dismiss "Dismiss"
```
**ts-1** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "1 place left"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = "Bread Baking Basics"
    text chosenWhen = "12 Oct · Community Kitchen"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "2 of 3"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "1"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = Bread Baking Basics
        field name = ""
        field email = ""
        button signUp "Sign up"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for Bread Baking Basics by email address."
        field cancelEmail = ""
        button cancel "Cancel sign-up" (disabled)
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (2 rows)
        row 1:
          text name = "Mia de Vries"
          text email = "mia@example.org"
        row 2:
          text name = "Tom Bakker"
          text email = "tom@example.org"
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
```

### Divergence in session 6 after 4 action(s)

```
  click pick on row 1 of eventList
  type "Ann Smith" into name
  type "Repair Guest 1" into cancelEmail
→ choose option 5 in chosenEvent
```

**elm-1, elm-2, elm-3, ts-2, ts-3** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "1 place left"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = ""
    text chosenWhen = "·"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "0 of 0"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "0"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = 
        field name = "Ann Smith"
        field email = ""
        button signUp "Join the waiting list"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for by email address."
        field cancelEmail = ""
        button cancel "Cancel sign-up" (disabled)
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (0 rows)
      section noAttendees
        text noAttendeesTitle = "Nobody yet"
        text noAttendeesHint = "Sign-ups for this event appear here."
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
section toast
  text toast.message = "Managing ."
  button toast.dismiss "Dismiss"
```
**ts-1** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "1 place left"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = "Bread Baking Basics"
    text chosenWhen = "12 Oct · Community Kitchen"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "2 of 3"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "1"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = Bread Baking Basics
        field name = "Ann Smith"
        field email = ""
        button signUp "Sign up"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for Bread Baking Basics by email address."
        field cancelEmail = "Repair Guest 1"
        button cancel "Cancel sign-up"
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (2 rows)
        row 1:
          text name = "Mia de Vries"
          text email = "mia@example.org"
        row 2:
          text name = "Tom Bakker"
          text email = "tom@example.org"
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
section toast
  text toast.message = "Managing Bread Baking Basics."
  button toast.dismiss "Dismiss"
```

### Divergence in session 7 after 11 action(s)

```
  click cancel
  type "compost2@example.org" into name
  click signUp
  click toast.dismiss
  type "repair3@example.org" into email
  click pager.previous
  click signUp
→ choose option 4 in chosenEvent
```

**elm-1, elm-2, elm-3, ts-2, ts-3** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "Full"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = ""
    text chosenWhen = "·"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "0 of 0"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "0"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = 
        field name = ""
        field email = ""
        button signUp "Join the waiting list"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for by email address."
        field cancelEmail = ""
        button cancel "Cancel sign-up" (disabled)
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (0 rows)
      section noAttendees
        text noAttendeesTitle = "Nobody yet"
        text noAttendeesHint = "Sign-ups for this event appear here."
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
section toast
  text toast.message = "Managing ."
  button toast.dismiss "Dismiss"
```
**ts-1** see:
```
section top
  heading "Community workshops"
  text subtitle = "Upcoming events, sign-ups and waiting lists"
section content
  section eventsCard
    section eventsBar
      heading "Upcoming events"
      select filter = All
    list eventList (4 rows)
      row 1:
        text title = "Bread Baking Basics"
        text date = "12 Oct"
        text location = "Community Kitchen"
        text places = "Full"
        button pick "Manage"
      row 2:
        text title = "Bike Repair"
        text date = "14 Oct"
        text location = "Old Fire Station"
        text places = "Full"
        button pick "Manage"
      row 3:
        text title = "Intro to Pottery"
        text date = "18 Oct"
        text location = "Clay Studio"
        text places = "6 places left"
        button pick "Manage"
      row 4:
        text title = "Beekeeping for Beginners"
        text date = "20 Oct"
        text location = "Allotment Gardens"
        text places = "1 place left"
        button pick "Manage"
    section pagerBar
      section pager
        text pager.pageInfo = "Page 1 of 3"
        button pager.previous "Previous" (disabled)
        button pager.next "Next"
  section chosenHeader
    text chosenTitle = "Bread Baking Basics"
    text chosenWhen = "12 Oct · Community Kitchen"
  section stats
    section confirmedStat
      text confirmedLabel = "Signed up"
      text confirmedValue = "3 of 3"
    section placesStat
      text placesLabel = "Places left"
      text placesValue = "0"
    section waitingStat
      text waitingLabel = "Waiting"
      text waitingValue = "0"
  section forms
    section signUpCard
      section signUpForm
        select chosenEvent = Bread Baking Basics
        field name = ""
        field email = ""
        button signUp "Join the waiting list"
    section cancelCard
      section cancelForm
        text cancelHint = "Cancel a sign-up for Bread Baking Basics by email address."
        field cancelEmail = ""
        button cancel "Cancel sign-up" (disabled)
  section peopleGrid
    section attendeesCard
      heading "Signed up"
      list attendeeList (3 rows)
        row 1:
          text name = "Mia de Vries"
          text email = "mia@example.org"
        row 2:
          text name = "Tom Bakker"
          text email = "tom@example.org"
        row 3:
          text name = "compost2@example.org"
          text email = "repair3@example.org"
    section waitingCard
      heading "Waiting list"
      list waitingRows (0 rows)
      section noWaiting
        text noWaitingTitle = "Nobody waiting"
        text noWaitingHint = "When the event is full, new sign-ups queue here in order."
section toast
  text toast.message = "compost2@example.org is signed up for Bread Baking Basics."
  button toast.dismiss "Dismiss"
```

(9 diverging sessions in total)

## Inventory

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)

- **ts-1: the page differs from the logic in 3 session(s):** screen[6].toast.c[1].toast.message.v: the page shows "Received 9 ×", the screen says "Received 9 × "
- **ts-2: the page differs from the logic in 3 session(s):** screen[6].toast.c[1].toast.message.v: the page shows "Received 9 ×", the screen says "Received 9 × "
- **ts-3: the page differs from the logic in 3 session(s):** screen[6].toast.c[1].toast.message.v: the page shows "Received 9 ×", the screen says "Received 9 × "
- **elm-3: the page differs from the logic in 3 session(s):** screen[6].toast.c[1].toast.message.v: the page shows "Received 9 ×", the screen says "Received 9 × "
- **elm-1: the page differs from the logic in 3 session(s):** screen[6].toast.c[1].toast.message.v: the page shows "Received 9 ×", the screen says "Received 9 × "
- **elm-2: the page differs from the logic in 3 session(s):** screen[6].toast.c[1].toast.message.v: the page shows "Received 9 ×", the screen says "Received 9 × "

Contact sheets: `r14-heldout/inventory/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 93%, ts-2 100%, ts-3 93%

### Divergence in session 9 after 9 action(s)

```
  choose option 4 in partChoice
  type "10.10" into amount
  click toast.dismiss
  choose AllCategories in category
  click pager.previous
  type "5" into amount
  click toast.dismiss
→ click pick
```

**elm-1, elm-2, elm-3, ts-2** see:
```
section top
  section titleBlock
    heading "Bike shop warehouse"
    text subtitle = "Parts, stock levels and movements"
section stats
  section lowStat
    text lowLabel = "At or below reorder level"
    text lowValue = "4"
  section totalStat
    text totalLabel = "Parts"
    text totalValue = "14"
section stockCard
  section filters
    field search = ""
    select category = AllCategories
    select sortBy = ByName
  list shown (6 rows)
    row 1:
      text name = "Brake cable"
      text sku = "CBL-002"
      text category = "Cables"
      text stock = "4"
      text reorderLevel = "8"
      text lowFlag = "Reorder"
    row 2:
      text name = "Brake fluid"
      text sku = "BRK-013"
      text category = "Brakes"
      text stock = "6"
      text reorderLevel = "3"
    row 3:
      text name = "Brake pads (disc)"
      text sku = "BRK-001"
      text category = "Brakes"
      text stock = "24"
      text reorderLevel = "10"
    row 4:
      text name = "Brake rotor 160mm"
      text sku = "BRK-010"
      text category = "Brakes"
      text stock = "5"
      text reorderLevel = "4"
    row 5:
      text name = "Cable housing"
      text sku = "CBL-014"
      text category = "Cables"
      text stock = "11"
      text reorderLevel = "5"
    row 6:
      text name = "Cassette 11-32"
      text sku = "DRV-004"
      text category = "Drivetrain"
      text stock = "3"
      text reorderLevel = "3"
      text lowFlag = "Reorder"
  section paging
    section pager
      text pager.pageInfo = "Page 1 of 3"
      button pager.previous "Previous" (disabled)
      button pager.next "Next"
section moveCard
  section moveForm
    select partChoice = 
    field amount = "5"
    button receive "Receive"
    button pick "Pick for order"
section historyCard
  text noHistory = "No movements yet."
section toast
  text toast.message = "Cannot pick 5 × : only 0 in stock"
  button toast.dismiss "Dismiss"
```
**ts-1, ts-3** see:
```
section top
  section titleBlock
    heading "Bike shop warehouse"
    text subtitle = "Parts, stock levels and movements"
section stats
  section lowStat
    text lowLabel = "At or below reorder level"
    text lowValue = "4"
  section totalStat
    text totalLabel = "Parts"
    text totalValue = "14"
section stockCard
  section filters
    field search = ""
    select category = AllCategories
    select sortBy = ByName
  list shown (6 rows)
    row 1:
      text name = "Brake cable"
      text sku = "CBL-002"
      text category = "Cables"
      text stock = "4"
      text reorderLevel = "8"
      text lowFlag = "Reorder"
    row 2:
      text name = "Brake fluid"
      text sku = "BRK-013"
      text category = "Brakes"
      text stock = "6"
      text reorderLevel = "3"
    row 3:
      text name = "Brake pads (disc)"
      text sku = "BRK-001"
      text category = "Brakes"
      text stock = "24"
      text reorderLevel = "10"
    row 4:
      text name = "Brake rotor 160mm"
      text sku = "BRK-010"
      text category = "Brakes"
      text stock = "5"
      text reorderLevel = "4"
    row 5:
      text name = "Cable housing"
      text sku = "CBL-014"
      text category = "Cables"
      text stock = "11"
      text reorderLevel = "5"
    row 6:
      text name = "Cassette 11-32"
      text sku = "DRV-004"
      text category = "Drivetrain"
      text stock = "3"
      text reorderLevel = "3"
      text lowFlag = "Reorder"
  section paging
    section pager
      text pager.pageInfo = "Page 1 of 3"
      button pager.previous "Previous" (disabled)
      button pager.next "Next"
section moveCard
  section moveForm
    select partChoice = 
    field amount = "5"
    button receive "Receive"
    button pick "Pick for order"
section historyCard
  text noHistory = "No movements yet."
```

(2 diverging sessions in total)

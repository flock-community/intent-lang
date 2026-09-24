module Fmt exposing (addDays, addMinutes, cents, clock, dateOf, daysBetween, decimal, fixed, formatDate, formatDateTime, int, minutesBetween, money, parseDate, parseDateTime, parseDecimal, parseInt, roundDownTo, roundTo, roundUpTo, timeOf, weekday)

{-| Standard formatting and parsing helpers. Must behave exactly like runtime/ts/fmt.ts.
-}


{-| `x` with exactly `places` decimals, rounding half away from zero. fixed 2 1.005 == "1.01"
-}
fixed : Int -> Float -> String
fixed places x =
    let
        f =
            toFloat (10 ^ places)

        r =
            floor (abs x * f + 0.5 + 1.0e-9)

        sign =
            if x < 0 && r /= 0 then
                "-"

            else
                ""

        digits =
            String.padLeft (places + 1) '0' (String.fromInt r)

        len =
            String.length digits
    in
    if places == 0 then
        sign ++ digits

    else
        sign ++ String.left (len - places) digits ++ "." ++ String.right places digits


{-| At most `places` decimals, trailing zeros (and a trailing ".") removed. decimal 8 (0.1 + 0.2) == "0.3"
-}
decimal : Int -> Float -> String
decimal places x =
    let
        s =
            fixed places x

        dropZeros str =
            if String.endsWith "0" str then
                dropZeros (String.dropRight 1 str)

            else
                str
    in
    if String.contains "." s then
        let
            t =
                dropZeros s
        in
        if String.endsWith "." t then
            String.dropRight 1 t

        else
            t

    else
        s


{-| Money: two decimals. money 3.5 == "3.50"
-}
money : Float -> String
money x =
    fixed 2 x


{-| Plain digits. int -3 == "-3"
-}
int : Int -> String
int n =
    String.fromInt n


{-| Seconds as a clock: "m:ss", or "h:mm:ss" from one hour up. clock 1500 == "25:00"
-}
clock : Int -> String
clock totalSeconds =
    let
        s =
            max 0 totalSeconds

        h =
            s // 3600

        m =
            modBy 3600 s // 60

        ss =
            modBy 60 s

        two n =
            String.padLeft 2 '0' (String.fromInt n)
    in
    if h > 0 then
        String.fromInt h ++ ":" ++ two m ++ ":" ++ two ss

    else
        String.fromInt m ++ ":" ++ two ss


{-| A decimal typed by a user: `-?digits([.,]digits)?`, surrounding spaces ignored. Nothing otherwise.
-}
parseDecimal : String -> Maybe Float
parseDecimal text =
    let
        s =
            String.trim text

        body =
            if String.startsWith "-" s then
                String.dropLeft 1 s

            else
                s

        digits p =
            p /= "" && String.all Char.isDigit p

        valid =
            case String.split "." (String.replace "," "." body) of
                [ a ] ->
                    digits a

                [ a, b ] ->
                    digits a && digits b && List.length (String.indexes "," body) + List.length (String.indexes "." body) == 1

                _ ->
                    False
    in
    if valid then
        String.toFloat (String.replace "," "." s)

    else
        Nothing


{-| A whole number typed by a user. Nothing if not a whole number.
-}
parseInt : String -> Maybe Int
parseInt text =
    let
        s =
            String.trim text

        body =
            if String.startsWith "-" s then
                String.dropLeft 1 s

            else
                s
    in
    if body /= "" && String.all Char.isDigit body then
        String.toInt s

    else
        Nothing


-- Rounding. Every build must round through these (never a home-made epsilon), so builds agree to the last cent.


eps : Float
eps =
    1.0e-9


{-| Round to `places` decimals, half away from zero. roundTo 2 1.875 == 1.88
-}
roundTo : Int -> Float -> Float
roundTo places x =
    let
        f =
            toFloat (10 ^ places)

        r =
            toFloat (floor (abs x * f + 0.5 + eps))
    in
    (if x < 0 then
        -r

     else
        r
    )
        / f


{-| Round up (towards +infinity) to `places` decimals. roundUpTo 2 36.6666 == 36.67
-}
roundUpTo : Int -> Float -> Float
roundUpTo places x =
    let
        f =
            toFloat (10 ^ places)
    in
    toFloat (ceiling (x * f - eps)) / f


{-| Round down (towards -infinity) to `places` decimals. roundDownTo 2 36.6666 == 36.66
-}
roundDownTo : Int -> Float -> Float
roundDownTo places x =
    let
        f =
            toFloat (10 ^ places)
    in
    toFloat (floor (x * f + eps)) / f


{-| A money amount as whole cents, half away from zero. cents 12.345 == 1235
-}
cents : Float -> Int
cents x =
    let
        r =
            floor (abs x * 100 + 0.5 + eps)
    in
    if x < 0 then
        -r

    else
        r



-- DATES AND MOMENTS
-- A Date is "YYYY-MM-DD", a DateTime "YYYY-MM-DDTHH:MM", both in the app's own local time.


{-| Division rounding down (Elm's `//` rounds towards zero).
-}
fdiv : Int -> Int -> Int
fdiv a b =
    (a - modBy b a) // b


num : String -> Int
num s =
    Maybe.withDefault 0 (String.toInt s)


pad : Int -> Int -> String
pad w n =
    String.padLeft w '0' (String.fromInt n)


daysFromCivil : Int -> Int -> Int -> Int
daysFromCivil y m d =
    let
        yy =
            if m <= 2 then
                y - 1

            else
                y

        era =
            fdiv yy 400

        yoe =
            yy - era * 400

        doy =
            fdiv
                (153
                    * (if m > 2 then
                        m - 3

                       else
                        m + 9
                      )
                    + 2
                )
                5
                + d
                - 1

        doe =
            yoe * 365 + fdiv yoe 4 - fdiv yoe 100 + doy
    in
    era * 146097 + doe - 719468


civilFromDays : Int -> ( Int, Int, Int )
civilFromDays days =
    let
        z =
            days + 719468

        era =
            fdiv z 146097

        doe =
            z - era * 146097

        yoe =
            fdiv (doe - fdiv doe 1460 + fdiv doe 36524 - fdiv doe 146096) 365

        doy =
            doe - (365 * yoe + fdiv yoe 4 - fdiv yoe 100)

        mp =
            fdiv (5 * doy + 2) 153

        d =
            doy - fdiv (153 * mp + 2) 5 + 1

        m =
            if mp < 10 then
                mp + 3

            else
                mp - 9

        y =
            yoe
                + era
                * 400
                + (if m <= 2 then
                    1

                   else
                    0
                  )
    in
    ( y, m, d )


dayNumber : String -> Int
dayNumber date =
    daysFromCivil (num (String.slice 0 4 date)) (num (String.slice 5 7 date)) (num (String.slice 8 10 date))


fromDayNumber : Int -> String
fromDayNumber n =
    let
        ( y, m, d ) =
            civilFromDays n
    in
    pad 4 y ++ "-" ++ pad 2 m ++ "-" ++ pad 2 d


minuteNumber : String -> Int
minuteNumber dt =
    dayNumber (String.slice 0 10 dt) * 1440 + num (String.slice 11 13 dt) * 60 + num (String.slice 14 16 dt)


fromMinuteNumber : Int -> String
fromMinuteNumber n =
    let
        day =
            fdiv n 1440

        r =
            n - day * 1440
    in
    fromDayNumber day ++ "T" ++ pad 2 (r // 60) ++ ":" ++ pad 2 (modBy 60 r)


{-| The date n days later (earlier when n < 0). addDays "2026-02-27" 2 == "2026-03-01"
-}
addDays : String -> Int -> String
addDays date n =
    fromDayNumber (dayNumber date + n)


{-| Whole days from one date to another.
-}
daysBetween : String -> String -> Int
daysBetween from to =
    dayNumber to - dayNumber from


{-| The day of the week, in English: weekday "2026-09-24" == "Thursday"
-}
weekday : String -> String
weekday date =
    case modBy 7 (dayNumber date + 3) of
        0 ->
            "Monday"

        1 ->
            "Tuesday"

        2 ->
            "Wednesday"

        3 ->
            "Thursday"

        4 ->
            "Friday"

        5 ->
            "Saturday"

        _ ->
            "Sunday"


{-| The date of a moment.
-}
dateOf : String -> String
dateOf dateTime =
    String.slice 0 10 dateTime


{-| The time of day of a moment: "09:30".
-}
timeOf : String -> String
timeOf dateTime =
    String.slice 11 16 dateTime


{-| The moment n minutes later.
-}
addMinutes : String -> Int -> String
addMinutes dateTime n =
    fromMinuteNumber (minuteNumber dateTime + n)


{-| Whole minutes from one moment to another.
-}
minutesBetween : String -> String -> Int
minutesBetween from to =
    minuteNumber to - minuteNumber from


monthName : Int -> String
monthName m =
    Maybe.withDefault "" (List.head (List.drop (m - 1) [ "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" ]))


{-| A date for people: formatDate "2026-09-04" == "4 Sep 2026"
-}
formatDate : String -> String
formatDate date =
    String.fromInt (num (String.slice 8 10 date)) ++ " " ++ monthName (num (String.slice 5 7 date)) ++ " " ++ String.slice 0 4 date


{-| A moment for people: "4 Sep 2026 09:05".
-}
formatDateTime : String -> String
formatDateTime dateTime =
    formatDate (String.slice 0 10 dateTime) ++ " " ++ timeOf dateTime


isDigits : String -> Bool
isDigits s =
    s /= "" && String.all Char.isDigit s


{-| A date typed as "YYYY-MM-DD" (spaces around ignored), only when it exists.
-}
parseDate : String -> Maybe String
parseDate text =
    let
        t =
            String.trim text

        shaped =
            String.length t == 10 && String.slice 4 5 t == "-" && String.slice 7 8 t == "-" && isDigits (String.slice 0 4 t) && isDigits (String.slice 5 7 t) && isDigits (String.slice 8 10 t)
    in
    if shaped && fromDayNumber (dayNumber t) == t then
        Just t

    else
        Nothing


{-| A moment typed as "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM", only when it exists.
-}
parseDateTime : String -> Maybe String
parseDateTime text =
    let
        t =
            String.trim text

        sep =
            String.slice 10 11 t

        hh =
            String.slice 11 13 t

        mm =
            String.slice 14 16 t
    in
    if String.length t == 16 && (sep == "T" || sep == " ") && String.slice 13 14 t == ":" && isDigits hh && isDigits mm && num hh <= 23 && num mm <= 59 then
        parseDate (String.slice 0 10 t) |> Maybe.map (\d -> d ++ "T" ++ hh ++ ":" ++ mm)

    else
        Nothing

module Fmt exposing (cents, clock, decimal, fixed, int, money, parseDecimal, parseInt, roundDownTo, roundTo, roundUpTo)

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

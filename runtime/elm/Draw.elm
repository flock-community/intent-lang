module Draw exposing (Source, Space(..), fromBase, many, notAmong, one, pick, readCode, shuffle, source)

{-| Random values (draws), owned by the harness: an app never makes its own, and never uses
`Random`. Every draw is a pure function of the event's seed and its place: HMAC-SHA-256(seed,
"site|row|index|block") on the reviewed SHA-256 of `Crypto`. A value never depends on how many draws
came before it, so the order a build evaluates in does not change it. Bytes become values by
rejection sampling (no modulo bias), `notAmong` skips taken values (and lists the free ones when half
or more are taken), shuffles are Fisher–Yates. The same code is runtime/ts/draw.ts; the test
tests/random.test.ts holds the two to identical values.

`steer` is the test driver's (a JavaScript object it reads through): it may hand out a steered
value for a place (`take|site|row|index|n`), and hears every value drawn (`drawn|site|row|index|value`).
Outside tests it is `null`, and nothing is steered.

-}

import Array
import Bitwise
import Crypto
import Json.Decode as D
import Set


{-| An event's draws: the key (32 bytes) and the driver's steering (null outside tests).
-}
type alias Source =
    { key : List Int, steer : D.Value }


{-| The values a random type has: a whole-number range, a code of n characters from an alphabet, or
named values (a choice, by its values' names).
-}
type Space
    = IntRange Int Int
    | Chars Int String
    | Names (List String)


{-| An event's draws from its seed (64 hex digits) and the driver's steering.
-}
source : String -> D.Value -> Source
source seed steer =
    { key = hexBytes seed, steer = steer }


{-| In the browser: the page's base seed (from the platform's CSPRNG) and the event's number.
-}
fromBase : String -> Int -> D.Value -> Source
fromBase base n steer =
    { key = hmac (hexBytes base) (ascii ("event|" ++ String.fromInt n)), steer = steer }



-- the forms


{-| `a random @T`: one value (index 0), or the index-th of `n random @T`, in its canonical text.
-}
one : Source -> String -> Int -> Int -> Space -> String
one src site row index space =
    let
        key =
            place site row index

        v =
            case take src key 0 of
                Just s ->
                    s

                Nothing ->
                    Tuple.first (valueFrom (stream src.key key) space)
    in
    report src key v v


{-| `n random @T`: n independent values (they may repeat).
-}
many : Source -> String -> Int -> Int -> Space -> List String
many src site row count space =
    -- In index order (List.map evaluates from the end): steered values go to the first index first.
    List.foldl (\i acc -> one src site row i space :: acc) [] (List.range 0 (count - 1))
        |> List.reverse


{-| `a random @T not among …`: a value not taken, uniform over the free ones; Nothing when every
value is taken.
-}
notAmong : Source -> String -> Int -> Space -> List String -> Maybe String
notAmong src site row space taken =
    let
        used =
            Set.fromList taken

        size =
            sizeOf space

        attempt k =
            let
                key =
                    place site row k
            in
            case take src key 0 of
                Just s ->
                    if Set.member s used then
                        attempt (k + 1)

                    else
                        Just (report src key s s)

                Nothing ->
                    if size <= 4294967296 && Set.size used * 2 >= size then
                        let
                            free =
                                List.filter (\v -> not (Set.member v used)) (every space)
                        in
                        if List.isEmpty free then
                            Nothing

                        else
                            let
                                ( i, _ ) =
                                    uniform (stream src.key key) (List.length free)

                                v =
                                    Maybe.withDefault "" (Array.get i (Array.fromList free))
                            in
                            Just (report src key v v)

                    else
                        let
                            v =
                                Tuple.first (valueFrom (stream src.key key) space)
                        in
                        if Set.member v used then
                            attempt (k + 1)

                        else
                            Just (report src key v v)
    in
    attempt 0


{-| `@xs shuffled`: the same items in a uniformly random order (Fisher–Yates, Durstenfeld).
-}
shuffle : Source -> String -> Int -> List a -> List a
shuffle src site row xs =
    let
        key =
            place site row 0

        steered =
            take src key (List.length xs)

        swaps i ( arr, s ) =
            let
                ( j, s2 ) =
                    uniform s (i + 1)

                a =
                    Array.get i arr

                b =
                    Array.get j arr
            in
            case ( a, b ) of
                ( Just x, Just y ) ->
                    ( Array.set i y (Array.set j x arr), s2 )

                _ ->
                    ( arr, s2 )

        out =
            case steered of
                Just "keep" ->
                    xs

                Just "reverse" ->
                    List.reverse xs

                _ ->
                    List.foldl swaps ( Array.fromList xs, stream src.key key ) (List.reverse (List.range 1 (List.length xs - 1)))
                        |> Tuple.first
                        |> Array.toList
    in
    report src key (Maybe.withDefault "random" steered) out


{-| `a random one of @xs`: one item, uniformly; Nothing for an empty list. A steered pick counts
from 1 (past the end: the last).
-}
pick : Source -> String -> Int -> List a -> Maybe a
pick src site row xs =
    if List.isEmpty xs then
        Nothing

    else
        let
            key =
                place site row 0

            n =
                List.length xs

            i =
                case take src key n |> Maybe.andThen digits of
                    Just p ->
                        if p >= 1 then
                            min p n - 1

                        else
                            Tuple.first (uniform (stream src.key key) n)

                    Nothing ->
                        Tuple.first (uniform (stream src.key key) n)
        in
        report src key (String.fromInt (i + 1)) (Array.get i (Array.fromList xs))



{-| A steered position: digits only (as the TypeScript runtime reads it); `+2` or ` 2` is no steering. -}
digits : String -> Maybe Int
digits s =
    if s /= "" && String.all Char.isDigit s then
        String.toInt s

    else
        Nothing



-- codes as input


{-| A code read the way its alphabet says: `unambiguous` codes Crockford's way (lower case
accepted, o/O as 0, i/I/l/L as 1, hyphens ignored), every other alphabet exactly. The normal form,
or Nothing when the text is not a code of n characters.
-}
readCode : Int -> String -> Bool -> String -> Maybe String
readCode n alphabet unambiguous text =
    let
        s =
            if unambiguous then
                text
                    |> String.replace "-" ""
                    |> String.toUpper
                    |> String.map
                        (\c ->
                            if c == 'O' then
                                '0'

                            else if c == 'I' || c == 'L' then
                                '1'

                            else
                                c
                        )

            else
                text

        allowed =
            String.toList alphabet

        cs =
            String.toList s
    in
    if List.length cs == n && List.all (\c -> List.member c allowed) cs then
        Just s

    else
        Nothing



-- the stream


type alias Stream =
    { key : List Int, label : String, block : Int, words : List Int }


stream : List Int -> String -> Stream
stream key label =
    { key = key, label = label, block = -1, words = [] }


next : Stream -> ( Int, Stream )
next s =
    case s.words of
        w :: rest ->
            ( w, { s | words = rest } )

        [] ->
            let
                b =
                    s.block + 1

                h =
                    hmac s.key (ascii (s.label ++ "|" ++ String.fromInt b))
            in
            next { s | block = b, words = words h }


{-| A uniform whole number in [0, n), n ≤ 2^32: rejection sampling, never modulo alone (its bias).
-}
uniform : Stream -> Int -> ( Int, Stream )
uniform s n =
    if n <= 1 then
        ( 0, s )

    else
        let
            limit =
                4294967296 - modBy n 4294967296

            ( w, s2 ) =
                next s
        in
        if w < limit then
            ( modBy n w, s2 )

        else
            uniform s2 n


valueFrom : Stream -> Space -> ( String, Stream )
valueFrom s space =
    case space of
        IntRange lo hi ->
            Tuple.mapFirst (\i -> String.fromInt (lo + i)) (uniform s (hi - lo + 1))

        Names values ->
            Tuple.mapFirst (\i -> Maybe.withDefault "" (Array.get i (Array.fromList values))) (uniform s (List.length values))

        Chars n alphabet ->
            let
                cs =
                    Array.fromList (String.toList alphabet)

                step _ ( acc, st ) =
                    let
                        ( i, st2 ) =
                            uniform st (Array.length cs)
                    in
                    ( acc ++ String.fromChar (Maybe.withDefault ' ' (Array.get i cs)), st2 )
            in
            List.foldl step ( "", s ) (List.range 1 n)


sizeOf : Space -> Int
sizeOf space =
    case space of
        IntRange lo hi ->
            hi - lo + 1

        Names values ->
            List.length values

        Chars n alphabet ->
            List.length (String.toList alphabet) ^ n


every : Space -> List String
every space =
    case space of
        IntRange lo hi ->
            List.map String.fromInt (List.range lo hi)

        Names values ->
            values

        Chars n alphabet ->
            let
                cs =
                    Array.fromList (String.toList alphabet)

                k =
                    Array.length cs

                code i =
                    List.foldl
                        (\_ ( acc, x ) -> ( String.fromChar (Maybe.withDefault ' ' (Array.get (modBy k x) cs)) ++ acc, floor (toFloat x / toFloat k) ))
                        ( "", i )
                        (List.range 1 n)
                        |> Tuple.first
            in
            List.map code (List.range 0 (k ^ n - 1))



-- keyed hashing


hmac : List Int -> List Int -> List Int
hmac key msg =
    let
        k =
            (if List.length key > 64 then
                Crypto.sha256Bytes key

             else
                key
            )
                |> (\x -> x ++ List.repeat (64 - List.length x) 0)
    in
    Crypto.sha256Bytes (List.map (Bitwise.xor 0x5C) k ++ Crypto.sha256Bytes (List.map (Bitwise.xor 0x36) k ++ msg))


words : List Int -> List Int
words bytes =
    case bytes of
        a :: b :: c :: d :: rest ->
            (a * 16777216 + b * 65536 + c * 256 + d) :: words rest

        _ ->
            []


place : String -> Int -> Int -> String
place site row index =
    site ++ "|" ++ String.fromInt row ++ "|" ++ String.fromInt index


ascii : String -> List Int
ascii s =
    Crypto.utf8 s


hexBytes : String -> List Int
hexBytes hex =
    let
        digit c =
            if Char.isDigit c then
                Char.toCode c - 48

            else
                Char.toCode (Char.toLower c) - 87

        pairs cs =
            case cs of
                a :: b :: rest ->
                    (digit a * 16 + digit b) :: pairs rest

                _ ->
                    []
    in
    pairs (String.toList hex)




-- the driver's steering (tests only)


take : Source -> String -> Int -> Maybe String
take src key n =
    D.decodeValue (D.field ("take|" ++ key ++ "|" ++ String.fromInt n) (D.nullable D.string)) src.steer
        |> Result.toMaybe
        |> Maybe.andThen identity


{-| Tell the driver what was drawn here (nothing happens outside tests), and go on with `result`.
-}
report : Source -> String -> String -> a -> a
report src key value result =
    case D.decodeValue (D.field ("drawn|" ++ key ++ "|" ++ value) D.bool) src.steer of
        Ok _ ->
            result

        Err _ ->
            result

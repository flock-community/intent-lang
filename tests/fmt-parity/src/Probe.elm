port module Probe exposing (main)

import Crypto
import Fmt
import Json.Encode as J


port out : J.Value -> Cmd msg


shaTexts : List String
shaTexts =
    [ "", "abc", "a", "Café", "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "The quick brown fox jumps over the lazy dog" ]


floats : List Float
floats =
    [ 0, 1.005, 2.675, -1.005, 1.875, 0.125, -0.001, 36.666666, 1e9 + 0.5, 14.38, 115, 0.1 + 0.2, -2.5, 2.5, 1234567.891 ]


texts : List String
texts =
    [ "", " ", "12", " 12,50 ", "12.5", "-3", "-", ".5", "5.", "1,2,3", "1.2.3", "abc", "0012", "-0", "1e5", "+4", "3,75", "  -12.25 " ]


dates : List String
dates =
    [ "2026-09-24", "2024-02-28", "2024-02-29", "2023-02-28", "2000-02-29", "2100-02-28", "1970-01-01", "1969-12-31", "1900-03-01", "2026-12-31", "0001-01-01" ]


moments : List String
moments =
    [ "2026-09-24T09:00", "2026-09-24T23:50", "2024-02-28T23:59", "1970-01-01T00:00", "1969-12-31T23:30" ]


dateTexts : List String
dateTexts =
    [ "2026-09-24", " 2026-09-24 ", "2026-02-30", "2024-02-29", "2023-02-29", "2026-13-01", "26-09-24", "2026-9-24", "", "2026-09-24T09:00", "2026-09-24 09:00", "2026-09-24 24:00", "2026-09-24T09:60", "2026-09-24T9:00" ]


maybeString : Maybe String -> J.Value
maybeString m =
    Maybe.withDefault J.null (Maybe.map J.string m)


main : Program () () ()
main =
    Platform.worker
        { init =
            \_ ->
                ( ()
                , out
                    (J.object
                        [ ( "fixed2", J.list J.string (List.map (Fmt.fixed 2) floats) )
                        , ( "fixed0", J.list J.string (List.map (Fmt.fixed 0) floats) )
                        , ( "fixed3", J.list J.string (List.map (Fmt.fixed 3) floats) )
                        , ( "clock", J.list J.string (List.map Fmt.clock [ 0, 59, 60, 1500, 3599, 3600, 3661, -5, 86399 ]) )
                        , ( "parseDecimal", J.list (\m -> Maybe.withDefault J.null (Maybe.map J.float m)) (List.map Fmt.parseDecimal texts) )
                        , ( "parseInt", J.list (\m -> Maybe.withDefault J.null (Maybe.map J.int m)) (List.map Fmt.parseInt texts) )
                        , ( "roundTo", J.list J.float (List.map (Fmt.roundTo 2) floats) )
                        , ( "roundUpTo", J.list J.float (List.map (Fmt.roundUpTo 2) floats) )
                        , ( "roundDownTo", J.list J.float (List.map (Fmt.roundDownTo 2) floats) )
                        , ( "cents", J.list J.int (List.map Fmt.cents floats) )
                        , ( "decimal", J.list J.string (List.map (Fmt.decimal 8) (floats ++ [ 1 / 3, -0.5, 100, 1.0e-9, -1.0e-9, 20 ])) )
                        , ( "int", J.list J.string (List.map Fmt.int [ 0, -3, 1200 ]) )
                        , ( "addDays", J.list J.string (List.concatMap (\d -> List.map (Fmt.addDays d) [ -366, -1, 0, 1, 30, 365 ]) dates) )
                        , ( "daysBetween", J.list J.int (List.map (Fmt.daysBetween "2026-09-24") dates) )
                        , ( "weekday", J.list J.string (List.map Fmt.weekday dates) )
                        , ( "formatDate", J.list J.string (List.map Fmt.formatDate dates) )
                        , ( "addMinutes", J.list J.string (List.concatMap (\t -> List.map (Fmt.addMinutes t) [ -1441, -1, 15, 60, 1440 ]) moments) )
                        , ( "minutesBetween", J.list J.int (List.map (Fmt.minutesBetween "2026-09-24T09:00") moments) )
                        , ( "formatDateTime", J.list J.string (List.map Fmt.formatDateTime moments) )
                        , ( "dateOf", J.list J.string (List.map (\t -> Fmt.dateOf t ++ " " ++ Fmt.timeOf t) moments) )
                        , ( "parseDate", J.list maybeString (List.map Fmt.parseDate dateTexts) )
                        , ( "parseDateTime", J.list maybeString (List.map Fmt.parseDateTime dateTexts) )
                        , ( "sha256", J.list J.string (List.map Crypto.sha256 shaTexts) )
                        ]
                    )
                )
        , update = \_ m -> ( m, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }

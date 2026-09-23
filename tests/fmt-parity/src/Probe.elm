port module Probe exposing (main)

import Fmt
import Json.Encode as J


port out : J.Value -> Cmd msg


floats : List Float
floats =
    [ 0, 1.005, 2.675, -1.005, 1.875, 0.125, -0.001, 36.666666, 1e9 + 0.5, 14.38, 115, 0.1 + 0.2, -2.5, 2.5, 1234567.891 ]


texts : List String
texts =
    [ "", " ", "12", " 12,50 ", "12.5", "-3", "-", ".5", "5.", "1,2,3", "1.2.3", "abc", "0012", "-0", "1e5", "+4", "3,75", "  -12.25 " ]


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
                        ]
                    )
                )
        , update = \_ m -> ( m, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }

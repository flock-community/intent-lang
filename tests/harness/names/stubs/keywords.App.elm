module App exposing (Model, init, update, view)

{-| A hand-written app module for tests/harness/names/build.ts: it proves the generated interface of a spec
whose names are target keywords compiles, and that its examples pass (no model involved).
-}

import Spec exposing (..)


type alias Model =
    { type_ : String, new_ : Int, val_ : Msg_, object_ : Bool, is_ : List Model_, as_ : Maybe String, fun_ : Int }


init : Model
init =
    { type_ = "", new_ = 0, val_ = Fun, object_ = False, is_ = [], as_ = Nothing, fun_ = 1 }


update : Msg -> Model -> Model
update msg m =
    case msg of
        TypeTyped t ->
            { m | type_ = t }

        ValChosen v ->
            { m | val_ = v }

        ObjectToggled ->
            { m | object_ = not m.object_ }

        ClassClicked ->
            { m | is_ = m.is_ ++ [ { id = List.length m.is_ + 1, in_ = m.type_, of_ = 0, class_ = False, when_ = "" } ], new_ = m.new_ + 1 }

        IsClassToggled k ->
            { m | is_ = List.map (\r -> if String.fromInt r.id == k then { r | class_ = not r.class_ } else r) m.is_ }

        IsBumpClicked k ->
            { m | is_ = List.map (\r -> if String.fromInt r.id == k then { r | of_ = r.of_ + 1 } else r) m.is_ }


view : Model -> Screen
view m =
    { type_ = m.type_
    , val_ = m.val_
    , object_ = m.object_
    , class_ = { enabled = True }
    , new_ = String.fromInt m.new_
    , when_ = String.fromInt (List.length m.is_)
    , is_ = List.map (\r -> { key = String.fromInt r.id, in_ = r.in_, of_ = String.fromInt r.of_, class_ = r.class_, bump = { enabled = True } }) m.is_
    }
